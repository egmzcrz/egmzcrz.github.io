// =============================================================
// DETAIL PANEL — Pure DOM construction (no innerHTML templates)
// =============================================================
import { STATE, getPlan } from './state.js';
import { StateManager } from './state-manager.js';
import { DOM } from './dom.js';
import { formatTimeHMS, parseTimeHHMM, showToast } from './utils.js';
import { shiftService, setStationDwell } from './schedule.js';
import { DEFAULT_BLOCK_LENGTH_M } from './constants.js';

export function updateDetailPanel() {
  const panel = DOM.get('detail-panel');
  const emptyState = DOM.get('detail-empty');
  const content = DOM.get('detail-content');

  if (!STATE.selectedService) {
    // Slide the panel off-screen. Content is left intact so it stays visible
    // throughout the right-bound exit animation rather than blanking first.
    panel.classList.remove('visible');
    return;
  }

  // Slide the panel into view over the chart.
  panel.classList.add('visible');
  emptyState.style.display = 'none';
  content.style.display = 'flex';
  content.innerHTML = '';

  const { planId, serviceIndex } = STATE.selectedService;
  const plan = getPlan(planId);
  if (!plan) return;
  const svc = plan.services[serviceIndex];
  if (!svc) return;

  const isNorth = svc.direction === 'north';

  // ---- Header ----
  content.appendChild(DOM.el('div', { className: 'detail-header' },
    DOM.el('div', { className: 'service-info' },
      DOM.el('h3', {},
        'Service ',
        DOM.el('span', { style: { color: plan.color } }, '#' + svc.serviceId)
      ),
      DOM.el('div', { className: 'meta' },
        DOM.el('span', { className: 'badge ' + (isNorth ? 'badge-north' : 'badge-south') },
          DOM.icon(isNorth ? 'fa-arrow-up' : 'fa-arrow-down'),
          ' ' + svc.direction
        ),
        DOM.el('span', { style: { marginLeft: '6px', color: 'var(--text-muted)' } }, plan.name || plan.serviceKey)
      )
    ),
    DOM.el('button', {
      className: 'btn-danger-text',
      onClick: function() { deleteService(planId, serviceIndex); }
    },
      DOM.icon('fa-trash'),
      ' Delete'
    )
  ));

  // ---- Signaling blocks (per-service overlay) ----
  content.appendChild(buildBlocksGroup(planId, serviceIndex, svc));

  // ---- Table wrapper ----
  const tableWrap = DOM.el('div', { className: 'detail-table-wrap' });

  const table = DOM.el('table', { className: 'detail-table' },
    DOM.el('thead', {},
      DOM.el('tr', {},
        DOM.el('th', {}, 'Station'),
        DOM.el('th', {}, 'Arrival'),
        DOM.el('th', {}, 'Departure')
      )
    ),
    DOM.el('tbody', {},
      svc.times.map(function(t, i) {
        return DOM.el('tr', {},
          DOM.el('td', { className: 'station-name', title: t.node }, t.node),
          DOM.el('td', {},
            DOM.el('input', {
              className: 'time-input',
              type: 'text',
              value: formatTimeHMS(t.arr),
              onChange: makeTimeEditHandler(planId, serviceIndex, i, 'arr')
            })
          ),
          DOM.el('td', {},
            DOM.el('input', {
              className: 'time-input',
              type: 'text',
              value: formatTimeHMS(t.dep),
              onChange: makeTimeEditHandler(planId, serviceIndex, i, 'dep')
            })
          )
        );
      })
    )
  );

  tableWrap.appendChild(table);
  content.appendChild(tableWrap);
}

/**
 * Build the per-service "Signaling blocks" group shown above the timetable.
 * A modern on/off switch toggles the overlay; a block-length input (always
 * visible, alongside the switch) sets the block length in metres. Both write
 * through StateManager (view state — no undo).
 */
function buildBlocksGroup(planId, serviceIndex, svc) {
  // Heal services that predate the per-service block fields so the switch and
  // length input always reflect concrete values (never blank / off-by-undefined).
  if (svc.blockLengthM == null) svc.blockLengthM = DEFAULT_BLOCK_LENGTH_M;
  const on = !!svc.showBlocks;

  const checkbox = DOM.el('input', {
    type: 'checkbox',
    onChange: function(e) { StateManager.setServiceShowBlocks(planId, serviceIndex, e.target.checked); }
  });
  checkbox.checked = on;   // set as property to avoid a sticky `checked` attribute

  const header = DOM.el('div', { className: 'blocks-header' },
    DOM.el('span', { className: 'blocks-title' },
      DOM.icon('fa-traffic-light'),
      ' Signaling blocks'
    ),
    DOM.el('label', { className: 'switch', title: 'Show signaling blocks for this service' },
      checkbox,
      DOM.el('span', { className: 'switch-slider' })
    )
  );

  const lengthRow = DOM.el('div', { className: 'blocks-length' },
    DOM.el('span', { className: 'blocks-length-label' }, 'Block length'),
    DOM.el('input', {
      className: 'time-filter-input block-length-input',
      type: 'number', min: '1', step: '50',
      value: svc.blockLengthM,
      'aria-label': 'Block length in metres',
      onChange: function(e) { StateManager.setServiceBlockLength(planId, serviceIndex, e.target.value); }
    }),
    DOM.el('span', { className: 'blocks-length-unit' }, 'm')
  );

  return DOM.el('div', { className: 'detail-blocks' }, header, lengthRow);
}

/** Create a closure-based handler for time input changes (replaces inline onchange). */
function makeTimeEditHandler(planId, serviceIndex, stationIdx, type) {
  return function(event) {
    onTimeEdit(planId, serviceIndex, stationIdx, type, event.target.value);
  };
}

export function deleteService(planId, serviceIndex) {
  StateManager.deleteService(planId, serviceIndex);
  showToast('Service deleted');
}

function onTimeEdit(planId, serviceIndex, stationIdx, type, valueStr) {
  const plan = getPlan(planId);
  if (!plan) return;
  const svc = plan.services[serviceIndex];
  if (!svc) return;

  const newMinutes = parseTimeHHMM(valueStr);
  if (isNaN(newMinutes)) {
    updateDetailPanel();
    return;
  }

  const entry = svc.times[stationIdx];
  StateManager.mutateService(planId, serviceIndex, s => {
    if (type === 'arr' || !entry.stop) {
      // Running times are fixed by physics → editing an arrival shifts the
      // whole trip so this station arrives at the requested time.
      shiftService(s, newMinutes - entry.arr);
    } else {
      // Editing a stop's departure changes its dwell.
      setStationDwell(s, stationIdx, newMinutes - entry.arr);
    }
  });
}

// =============================================================
// TIME FILTER INPUTS
// =============================================================
export function updateTimeFilterInputs() {
  DOM.get('time-start').value = STATE.timeFilterStart !== null ? formatTimeHMS(STATE.timeFilterStart) : '';
  DOM.get('time-end').value   = STATE.timeFilterEnd   !== null ? formatTimeHMS(STATE.timeFilterEnd)   : '';
}
