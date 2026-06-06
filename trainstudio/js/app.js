// =============================================================
// APP — Entry point, event wiring, orchestration
// =============================================================

// ---- Register state change subscribers ----
// Every state mutation automatically triggers these renders
StateManager.onChange(function() {
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
  updateUndoButtons();
  updateTimeFilterInputs();
});

// ---- Download ----
DOM.get('btn-download').addEventListener('click', () => {
  const workbook = XLSX.utils.book_new();

  const allRows = [];
  STATE.servicePlans.forEach(plan => {
    if (!plan.visible) return;
    plan.services.forEach(svc => {
      svc.times.forEach(t => {
        allRows.push({
          service_name: plan.serviceKey,
          service_id: svc.serviceId,
          direction: svc.direction,
          station: t.node,
          arrival: formatTimeHHMM(t.arr),
          departure: formatTimeHHMM(t.dep),
          arrival_min: Math.round(t.arr * 100) / 100,
          departure_min: Math.round(t.dep * 100) / 100
        });
      });
    });
  });

  if (allRows.length === 0) {
    showToast('No data to download', true);
    return;
  }

  const ws = XLSX.utils.json_to_sheet(allRows);
  ws['!cols'] = [
    { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 11 }, { wch: 11 }, { wch: 12 }, { wch: 12 }
  ];
  XLSX.utils.book_append_sheet(workbook, ws, 'timetable');

  XLSX.writeFile(workbook, 'timetable.xlsx');
  showToast('Timetable downloaded');
});

// ---- Resize Handler ----
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

// ---- Undo/Redo/Fit buttons ----
DOM.get('btn-undo').addEventListener('click', undo);
DOM.get('btn-redo').addEventListener('click', redo);
DOM.get('btn-fit').addEventListener('click', fitToView);

// ---- Keyboard Shortcuts ----
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

// ---- Deselect service when clicking empty chart area ----
DOM.get('chart-panel').addEventListener('click', () => {
  StateManager.deselectService();
});

// ---- Close modals on overlay click ----
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', function(e) {
    if (e.target === this) {
      this.style.display = 'none';
    }
  });
});

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

DOM.get('btn-time-apply').addEventListener('click', applyTimeFilter);
DOM.get('btn-time-reset').addEventListener('click', resetTimeFilter);

// Apply on Enter key in either input
DOM.get('time-start').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyTimeFilter();
});
DOM.get('time-end').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyTimeFilter();
});

// ---- Init ----
console.log('Train Studio ready');
console.log('Upload an Excel file to begin.');
