// =============================================================
// SERVICE PLANS — CRUD & modals
//
// A service plan is defined by a track geometry (CSV) + rolling stock
// (YAML) — which together are simulated into running dynamics — plus
// scheduling parameters: headway, start offset, dwell and direction.
// =============================================================
import { STATE } from './state.js';
import { StateManager } from './state-manager.js';
import { DOM } from './dom.js';
import { PLAN_COLORS, DAY_END_MIN, PLAN_DEFAULTS } from './constants.js';
import { Dynamics } from './dynamics.js';
import { buildTripFromProfile } from './schedule.js';
import { readFileText } from './parser.js';
import { openModal, closeModal, showToast, generateId } from './utils.js';

// ---- Corridor Select (Y-axis chooser) ----
export function populateCorridorSelect() {
  const sel = DOM.get('corridor-select');
  // Only corridors referenced by at least one current plan are selectable.
  // STATE.services keeps cached simulations around (for undo / re-adding a
  // plan on the same geometry), but an orphaned corridor must not linger in
  // the dropdown after its plan is deleted.
  const usedKeys = [...new Set(STATE.servicePlans.map(p => p.serviceKey))];
  // The value stays the serviceKey (the geometry the chart indexes on), but
  // the label shows the plan name(s) using that geometry instead of filenames.
  const options = usedKeys.map(key => {
    const names = [...new Set(
      STATE.servicePlans.filter(p => p.serviceKey === key).map(p => p.name).filter(Boolean)
    )];
    return DOM.el('option', { value: key }, names.length ? names.join(', ') : key);
  });
  sel.replaceChildren(...options);
  if (STATE.corridorView) sel.value = STATE.corridorView;
}

// ---- Add Plan Modal ----
function populateAddPlanModal() {
  // Default plan name — "Plan Service N", where N tracks the plan count so it
  // grows as plans are added and shrinks again when they're removed.
  DOM.get('add-plan-name').value = `Plan Service ${STATE.servicePlans.length + 1}`;

  // Scheduling defaults (single source of truth in constants.js).
  DOM.get('add-headway').value = PLAN_DEFAULTS.headwayMin;
  DOM.get('add-start-offset').value = PLAN_DEFAULTS.startOffsetMin;
  DOM.get('add-dwell').value = PLAN_DEFAULTS.dwellSec;
  DOM.get('add-direction').value = PLAN_DEFAULTS.direction;

  // Color palette
  const palette = DOM.get('add-color-palette');
  palette.innerHTML = '';
  const startIdx = STATE.planColorIndex % PLAN_COLORS.length;
  PLAN_COLORS.forEach((color, i) => {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch' + (i === startIdx ? ' selected' : '');
    swatch.style.background = color;
    swatch.dataset.color = color;
    swatch.addEventListener('click', () => {
      palette.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
    });
    palette.appendChild(swatch);
  });
}

export function openAddPlanModal() {
  populateAddPlanModal();
  openModal('modal-add-plan');
}

async function handleAddPlanConfirm() {
  const name = DOM.get('add-plan-name').value.trim();
  const geomFile = DOM.get('add-geom-file').files[0];
  const stockFile = DOM.get('add-stock-file').files[0];
  const headwayMin = parseInt(DOM.get('add-headway').value) || PLAN_DEFAULTS.headwayMin;
  const startOffsetMin = parseInt(DOM.get('add-start-offset').value) || PLAN_DEFAULTS.startOffsetMin;
  const dwellMin = (parseFloat(DOM.get('add-dwell').value) || 0) / 60; // seconds → minutes
  const direction = DOM.get('add-direction').value;
  const selectedColor = document.querySelector('#add-color-palette .color-swatch.selected');
  const color = selectedColor ? selectedColor.dataset.color : PLAN_COLORS[STATE.planColorIndex % PLAN_COLORS.length];

  if (!name) {
    showToast('Enter a name for the plan', true);
    return;
  }
  if (!geomFile || !stockFile) {
    showToast('Select both a geometry CSV and a rolling-stock YAML', true);
    return;
  }
  if (headwayMin < 1) {
    showToast('Headway must be at least 1 minute', true);
    return;
  }

  const confirmBtn = DOM.get('btn-add-plan-confirm');
  confirmBtn.disabled = true;
  const prevLabel = confirmBtn.textContent;
  confirmBtn.textContent = 'Simulating…';

  try {
    const [csvText, yamlText] = await Promise.all([readFileText(geomFile), readFileText(stockFile)]);

    // Cache by geometry + rolling-stock filename so repeated plans on the
    // same line/train reuse the simulation instead of recomputing it.
    const serviceKey = `${geomFile.name} · ${stockFile.name}`;
    if (!STATE.services[serviceKey]) {
      const serviceData = Dynamics.simulate(csvText, yamlText);
      StateManager.registerService(serviceKey, serviceData);
    }

    const plan = createServicePlan(name, serviceKey, headwayMin, startOffsetMin, dwellMin, direction, color);
    StateManager.addServicePlan(plan);
    closeModal('modal-add-plan');
    showToast(`Added ${name}`);
  } catch (err) {
    console.error(err);
    showToast('Simulation failed: ' + err.message, true);
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = prevLabel;
  }
}

export function createServicePlan(name, serviceKey, headwayMin, startOffsetMin, dwellMin, direction, color) {
  const data = STATE.services[serviceKey];
  if (!data) return null;

  const plan = {
    id: generateId(),
    name,
    serviceKey,
    headwayMin,
    startOffsetMin,
    dwellMin,
    direction,
    color,
    visible: true,
    services: []
  };

  // Unique even/odd IDs across all plans (north=even, south=odd)
  const allIds = STATE.servicePlans.flatMap(p => p.services.map(s => s.serviceId));
  let evenId = Math.max(0, ...allIds.filter(id => id % 2 === 0)) + 2;
  let oddId = Math.max(-1, ...allIds.filter(id => id % 2 !== 0)) + 2;

  // Seed new services from the sticky default (last block length the user set).
  const blockLen = STATE.lastBlockLengthM;
  for (let t = startOffsetMin; t <= DAY_END_MIN; t += headwayMin) {
    if (direction === 'north' || direction === 'both') {
      plan.services.push(buildTripFromProfile(data, 'north', t, dwellMin, serviceKey, evenId, blockLen));
      evenId += 2;
    }
    if (direction === 'south' || direction === 'both') {
      plan.services.push(buildTripFromProfile(data, 'south', t, dwellMin, serviceKey, oddId, blockLen));
      oddId += 2;
    }
  }

  return plan;
}

/** Wire all service-plan controls. Called once from app init (after DOM ready). */
export function initPlans() {
  DOM.get('corridor-select').addEventListener('change', function() {
    StateManager.setCorridorView(this.value);
  });
  DOM.get('btn-add-plan').addEventListener('click', openAddPlanModal);
  DOM.get('btn-add-plan-confirm').addEventListener('click', handleAddPlanConfirm);
  DOM.get('btn-edit-plans').addEventListener('click', () => {
    updatePlansModal();
    openModal('modal-edit-plans');
  });
}

export function updatePlansModal() {
  const container = DOM.get('edit-plans-list');
  container.innerHTML = '';

  if (STATE.servicePlans.length === 0) {
    container.appendChild(
      DOM.el('p', { style: { color: 'var(--text-muted)', fontSize: '13px' } }, 'No service plans yet.')
    );
    return;
  }

  STATE.servicePlans.forEach(function(plan) {
    const dwellS = Math.round((plan.dwellMin || 0) * 60);
    container.appendChild(
      DOM.el('div', { className: 'plan-list-item' + (plan.visible ? '' : ' hidden') },
        DOM.el('label', {
          className: 'plan-color',
          style: { background: plan.color },
          title: 'Click to change color'
        },
          DOM.el('input', {
            type: 'color',
            className: 'plan-color-input',
            value: plan.color,
            onChange: function(e) { StateManager.setPlanColor(plan.id, e.target.value); }
          })
        ),
        DOM.el('div', { className: 'plan-name', style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0' } },
          DOM.el('input', {
            type: 'text',
            className: 'plan-name-input',
            value: plan.name || plan.serviceKey,
            title: 'Rename plan',
            onChange: function(e) {
              const name = e.target.value.trim();
              if (name) {
                StateManager.setPlanName(plan.id, name);
              } else {
                e.target.value = plan.name || plan.serviceKey;
              }
            }
          }),
          DOM.el('span', { style: { fontSize: '11px', color: 'var(--text-muted)' } },
            plan.services.length + ' services · ' + plan.headwayMin + "' / " + plan.direction + ' / dwell ' + dwellS + 's'
          )
        ),
        DOM.el('button', {
          className: 'btn-icon',
          title: plan.visible ? 'Hide' : 'Show',
          onClick: function() { togglePlanVisibility(plan.id); }
        },
          DOM.icon(plan.visible ? 'fa-eye' : 'fa-eye-slash')
        ),
        DOM.el('button', {
          className: 'btn-icon',
          style: { color: 'var(--danger)' },
          title: 'Delete',
          onClick: function() { deletePlan(plan.id); }
        },
          DOM.icon('fa-trash')
        )
      )
    );
  });
}

function togglePlanVisibility(planId) {
  StateManager.togglePlanVisibility(planId);
}

function deletePlan(planId) {
  StateManager.removeServicePlan(planId);
  showToast('Service plan deleted');
}
