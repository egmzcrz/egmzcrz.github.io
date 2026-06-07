// =============================================================
// APP — Entry point, event wiring, orchestration
// =============================================================
import { STATE, chartState, undo, redo, updateUndoButtons } from './state.js';
import { StateManager } from './state-manager.js';
import { DOM } from './dom.js';
import { formatTimeHMS, parseTimeHHMM, showToast, closeModal } from './utils.js';
import { updateChart, initChart, fitToView } from './chart.js';
import { updateDetailPanel, updateTimeFilterInputs, deleteService } from './ui.js';
import { updatePlansModal, populateCorridorSelect, initPlans } from './plans.js';
import { initWelcomeOverlay } from './parser.js';

// ---- Render: run on every state change ----
function render() {
  // Each render is independently guarded so one failure doesn't block the rest
  try { updateChart(); } catch (err) {
    console.error('updateChart failed:', err);
    showToast('Chart display error — try resizing the window', true);
  }
  try { updateDetailPanel(); } catch (err) {
    console.error('updateDetailPanel failed:', err);
  }
  try { updatePlansModal(); } catch (err) {
    console.error('updatePlansModal failed:', err);
  }
  try { populateCorridorSelect(); } catch (err) {
    console.error('populateCorridorSelect failed:', err);
  }
  updateUndoButtons();
  updateTimeFilterInputs();
  updateUIState();
}

// ---- Enable/disable controls & toggle the welcome overlay ----
function updateUIState() {
  const hasServices = Object.keys(STATE.services).length > 0;
  const hasPlans = STATE.servicePlans.length > 0;

  DOM.get('corridor-select').disabled = !hasServices;
  DOM.get('btn-edit-plans').disabled = !hasPlans;
  DOM.get('btn-download').disabled = !hasPlans;
  DOM.get('btn-fit').disabled = !hasServices;

  DOM.get('upload-overlay').style.display = hasPlans ? 'none' : 'flex';
}

// ---- Download (CSV) ----
/** Quote a CSV field only when it contains a comma, quote, or newline. */
function csvCell(value) {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadTimetable() {
  const header = [
    'service_name', 'service_id', 'direction', 'station',
    'arrival', 'departure', 'arrival_min', 'departure_min'
  ];
  const rows = [header];

  STATE.servicePlans.forEach(plan => {
    if (!plan.visible) return;
    plan.services.forEach(svc => {
      svc.times.forEach(t => {
        rows.push([
          plan.name || plan.serviceKey,
          svc.serviceId,
          svc.direction,
          t.node,
          formatTimeHMS(t.arr),
          formatTimeHMS(t.dep),
          Math.round(t.arr * 100) / 100,
          Math.round(t.dep * 100) / 100
        ]);
      });
    });
  });

  if (rows.length === 1) {
    showToast('No data to download', true);
    return;
  }

  const csv = rows.map(r => r.map(csvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = DOM.el('a', { href: url, download: 'timetable.csv' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('Timetable downloaded');
}

// ---- Resize Handler (debounced) ----
function wireResize() {
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (STATE.services && Object.keys(STATE.services).length > 0) {
        initChart(true);   // preserve the current zoom/pan across resize
        updateChart();
      }
    }, 250);
  });
}

// ---- Keyboard Shortcuts ----
function wireKeyboard() {
  document.addEventListener('keydown', (e) => {
    // Ctrl+Z / Cmd+Z = Undo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }
    // Ctrl+Shift+Z / Cmd+Shift+Z = Redo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
      e.preventDefault();
      redo();
      return;
    }
    if (e.key === 'Escape') {
      StateManager.deselectService();
      closeModal('modal-add-plan');
      closeModal('modal-edit-plans');
      return;
    }
    // Don't hijack keys while the user is typing in an input/textarea/select
    const target = e.target;
    const isEditable = target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    );
    if (isEditable) return;

    // Backspace / Delete = delete the currently selected service
    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (STATE.selectedService) {
        e.preventDefault();
        const { planId, serviceIndex } = STATE.selectedService;
        deleteService(planId, serviceIndex);
      }
      return;
    }
    // F = fit chart to view
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      fitToView();
    }
  });
}

// ---- Modals ----
function wireModals() {
  // Close on overlay (backdrop) click.
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', function(e) {
      if (e.target === this) this.style.display = 'none';
    });
  });

  // Close-buttons inside modals (data-close="<modal-id>").
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  // Trap Tab focus within the open modal for keyboard accessibility.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const open = [...document.querySelectorAll('.modal-overlay')]
      .find(m => m.style.display === 'flex');
    if (!open) return;
    const focusable = [...open.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]'
    )].filter(el => el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

// ---- Time Filter ----
function applyTimeFilter() {
  const startStr = DOM.get('time-start').value.trim();
  const endStr   = DOM.get('time-end').value.trim();

  const parsedStart = startStr ? parseTimeHHMM(startStr) : null;
  const parsedEnd   = endStr   ? parseTimeHHMM(endStr)   : null;

  if (startStr && (parsedStart === null || isNaN(parsedStart))) {
    showToast('Invalid start time format (use HH:MM or HH:MM:SS)', true);
    return;
  }
  if (endStr && (parsedEnd === null || isNaN(parsedEnd))) {
    showToast('Invalid end time format (use HH:MM or HH:MM:SS)', true);
    return;
  }

  StateManager.setTimeFilter(parsedStart, parsedEnd);

  // Reset zoom so the filter range fills the view
  if (chartState.svg && chartState.zoom) {
    chartState.svg.call(chartState.zoom.transform, d3.zoomIdentity);
  }
}

function resetTimeFilter() {
  StateManager.clearTimeFilter();
  DOM.get('time-start').value = '';
  DOM.get('time-end').value = '';

  if (chartState.svg && chartState.zoom) {
    chartState.svg.call(chartState.zoom.transform, d3.zoomIdentity);
  }
}

function wireTimeFilter() {
  DOM.get('btn-time-apply').addEventListener('click', applyTimeFilter);
  DOM.get('btn-time-reset').addEventListener('click', resetTimeFilter);
  // Apply on Enter key in either input.
  DOM.get('time-start').addEventListener('keydown', e => { if (e.key === 'Enter') applyTimeFilter(); });
  DOM.get('time-end').addEventListener('keydown', e => { if (e.key === 'Enter') applyTimeFilter(); });
}

// ---- Init (called once, after the DOM is ready) ----
function init() {
  StateManager.onChange(render);

  DOM.get('btn-download').addEventListener('click', downloadTimetable);
  DOM.get('btn-undo').addEventListener('click', undo);
  DOM.get('btn-redo').addEventListener('click', redo);
  DOM.get('btn-fit').addEventListener('click', fitToView);
  DOM.get('chart-panel').addEventListener('click', () => StateManager.deselectService());

  wireResize();
  wireKeyboard();
  wireModals();
  wireTimeFilter();
  initPlans();
  initWelcomeOverlay();

  updateUIState();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
