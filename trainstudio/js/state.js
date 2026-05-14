// =============================================================
// STATE — Backward-compatible reference to StateManager
// =============================================================
// STATE is a direct reference to StateManager.state so all
// existing read-access (STATE.services, STATE.servicePlans, etc.)
// continues to work. Mutations should go through StateManager methods.
const STATE = StateManager.state;

// Chart rendering state (D3 references — not managed by StateManager)
let chartState = {
  svg: null,
  chartG: null,
  xScale: null,
  yScale: null,
  xAxis: null,
  yAxis: null,
  zoom: null,
  width: 0,
  height: 0,
  margin: { top: 30, right: 40, bottom: 40, left: 120 }
};

// ---- Legacy function wrappers (delegate to StateManager) ----
function pushUndo()   { StateManager.beginTimeEdit(); }
function undo()        { StateManager.undo(); }
function redo()        { StateManager.redo(); }
function snapshotState() { return StateManager.snapshot(); }
function restoreSnapshot(snap) { StateManager.restore(snap); }

// Legacy: update buttons (now driven by subscriber)
function updateUndoButtons() {
  const uBtn = DOM.get('btn-undo');
  const rBtn = DOM.get('btn-redo');
  uBtn.disabled = !StateManager.canUndo();
  uBtn.style.opacity = StateManager.canUndo() ? '1' : '0.4';
  rBtn.disabled = !StateManager.canRedo();
  rBtn.style.opacity = StateManager.canRedo() ? '1' : '0.4';
}
