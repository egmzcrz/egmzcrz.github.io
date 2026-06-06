// =============================================================
// SERVICE PLANS — CRUD & modals
// =============================================================

// ---- Corridor Select ----
function populateCorridorSelect() {
  const sel = DOM.get('corridor-select');
  sel.innerHTML = '';
  Object.keys(STATE.services).forEach(key => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = key;
    if (key === STATE.corridorView) opt.selected = true;
    sel.appendChild(opt);
  });
}

DOM.get('corridor-select').addEventListener('change', function() {
  StateManager.setCorridorView(this.value);
});

// ---- Add Plan Modal ----
function populateAddPlanModal() {
  const sel = DOM.get('add-service-select');
  sel.innerHTML = '';
  Object.keys(STATE.services).forEach(key => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = key;
    sel.appendChild(opt);
  });

  // Color palette
  const palette = DOM.get('add-color-palette');
  palette.innerHTML = '';
  PLAN_COLORS.forEach((color, i) => {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch' + (i === 0 ? ' selected' : '');
    swatch.style.background = color;
    swatch.dataset.color = color;
    swatch.addEventListener('click', () => {
      palette.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
    });
    palette.appendChild(swatch);
  });
}

DOM.get('btn-add-plan').addEventListener('click', () => {
  populateAddPlanModal();
  openModal('modal-add-plan');
});

DOM.get('btn-add-plan-confirm').addEventListener('click', () => {
  const serviceKey = DOM.get('add-service-select').value;
  const headwayMin = parseInt(DOM.get('add-headway').value) || 15;
  const startOffsetMin = parseInt(DOM.get('add-start-offset').value) || 360;
  const direction = DOM.get('add-direction').value;
  const selectedColor = document.querySelector('#add-color-palette .color-swatch.selected');
  const color = selectedColor ? selectedColor.dataset.color : PLAN_COLORS[STATE.planColorIndex % PLAN_COLORS.length];
  STATE.planColorIndex++;

  if (!serviceKey) {
    showToast('Please select a service', true);
    return;
  }
  if (headwayMin < 1) {
    showToast('Headway must be at least 1 minute', true);
    return;
  }

  const plan = createServicePlan(serviceKey, headwayMin, startOffsetMin, direction, color);
  StateManager.addServicePlan(plan);
  closeModal('modal-add-plan');
  showToast(`Added plan for ${serviceKey}`);
});

function createServicePlan(serviceKey, headwayMin, startOffsetMin, direction, color) {
  const data = STATE.services[serviceKey];
  if (!data) return null;

  const nodes = data.nodes;
  const baseRT = data.baseRunningTime;

  const plan = {
    id: generateId(),
    serviceKey,
    headwayMin,
    startOffsetMin,
    direction,
    color,
    visible: true,
    services: []
  };

  const DAY_END = 1440;
  let evenId = 2, oddId = 1;

  // Unique even/odd IDs across all plans (north=even, south=odd)
  const allIds = STATE.servicePlans.flatMap(p => p.services.map(s => s.serviceId));
  const maxEven = Math.max(0, ...allIds.filter(id => id % 2 === 0));
  const maxOdd  = Math.max(-1, ...allIds.filter(id => id % 2 !== 0));
  evenId = maxEven + 2;
  oddId  = maxOdd  + 2;  // -1 base → first odd = 1, then 3, 5...

  for (let t = startOffsetMin; t <= DAY_END; t += headwayMin) {
    if (direction === 'north' || direction === 'both') {
      const times = buildTripTimesForService(nodes, t, baseRT);
      plan.services.push({ serviceId: evenId, direction: 'north', times });
      evenId += 2;
    }
    if (direction === 'south' || direction === 'both') {
      const revNodes = [...nodes].reverse();
      const times = buildTripTimesForService(revNodes, t, baseRT);
      plan.services.push({ serviceId: oddId, direction: 'south', times });
      oddId += 2;
    }
  }

  return plan;
}

// ---- Edit Plans Modal ----
DOM.get('btn-edit-plans').addEventListener('click', () => {
  updatePlansModal();
  openModal('modal-edit-plans');
});

function updatePlansModal() {
  const container = DOM.get('edit-plans-list');
  container.innerHTML = '';

  if (STATE.servicePlans.length === 0) {
    container.appendChild(
      DOM.el('p', { style: { color: 'var(--text-muted)', fontSize: '13px' } }, 'No service plans yet.')
    );
    return;
  }

  STATE.servicePlans.forEach(function(plan) {
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
        DOM.el('span', { className: 'plan-name' }, plan.serviceKey + ' (' + plan.services.length + ' services)'),
        DOM.el('span', { style: { fontSize: '11px', color: 'var(--text-muted)' } },
          plan.headwayMin + "' / " + plan.direction
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
