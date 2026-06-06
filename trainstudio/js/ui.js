// =============================================================
// DETAIL PANEL — Pure DOM construction (no innerHTML templates)
// =============================================================

function updateDetailPanel() {
  const emptyState = DOM.get('detail-empty');
  const content = DOM.get('detail-content');

  if (!STATE.selectedService) {
    emptyState.style.display = 'flex';
    content.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  content.style.display = 'flex';
  content.innerHTML = '';

  const { planId, serviceIndex } = STATE.selectedService;
  const plan = STATE.servicePlans.find(p => p.id === planId);
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
        DOM.el('span', { style: { marginLeft: '6px', color: 'var(--text-muted)' } }, plan.serviceKey)
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
              value: formatTimeHHMM(t.arr),
              onChange: makeTimeEditHandler(planId, serviceIndex, i, 'arr')
            })
          ),
          DOM.el('td', {},
            DOM.el('input', {
              className: 'time-input',
              type: 'text',
              value: formatTimeHHMM(t.dep),
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

/** Create a closure-based handler for time input changes (replaces inline onchange). */
function makeTimeEditHandler(planId, serviceIndex, stationIdx, type) {
  return function(event) {
    onTimeEdit(planId, serviceIndex, stationIdx, type, event.target.value);
  };
}

function hideDetailPanel() {
  DOM.get('detail-empty').style.display = 'flex';
  DOM.get('detail-content').style.display = 'none';
}

function deleteService(planId, serviceIndex) {
  StateManager.deleteService(planId, serviceIndex);
  showToast('Service deleted');
}

function onTimeEdit(planId, serviceIndex, stationIdx, type, valueStr) {
  const plan = STATE.servicePlans.find(p => p.id === planId);
  if (!plan) return;
  const svc = plan.services[serviceIndex];
  if (!svc) return;

  const newMinutes = parseTimeHHMM(valueStr);
  if (isNaN(newMinutes)) {
    updateDetailPanel();
    return;
  }

  const isArrival = (type === 'arr');
  const constrained = constrainTime(svc, stationIdx, isArrival, newMinutes, plan.serviceKey);

  const oldVal = isArrival ? svc.times[stationIdx].arr : svc.times[stationIdx].dep;
  const delta = constrained - oldVal;

  if (Math.abs(delta) < 0.001) {
    updateDetailPanel();
    return;
  }

  StateManager.beginTimeEdit();
  propagateTimeDelta(svc, stationIdx, isArrival, delta);
  enforceConstraints(svc, plan.serviceKey);
  StateManager.endTimeEdit();
}

// =============================================================
// TIME FILTER INPUTS (used by undo/redo restore)
// =============================================================
function updateTimeFilterInputs() {
  DOM.get('time-start').value = STATE.timeFilterStart !== null ? formatTimeHHMM(STATE.timeFilterStart) : '';
  DOM.get('time-end').value   = STATE.timeFilterEnd   !== null ? formatTimeHHMM(STATE.timeFilterEnd)   : '';
}
