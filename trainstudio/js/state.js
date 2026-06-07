// =============================================================
// STATE — Shared read-access reference + chart render state
// =============================================================
import { StateManager } from './state-manager.js';
import { DOM } from './dom.js';

// STATE is a direct reference to StateManager.state so all read-access
// (STATE.services, STATE.servicePlans, etc.) is convenient. Mutations must
// go through StateManager methods.
export const STATE = StateManager.state;

/** Look up a service plan by id (null if not found). */
export function getPlan(planId) {
  return STATE.servicePlans.find(p => p.id === planId) || null;
}

// Chart rendering state (D3 references — not managed by StateManager).
export const chartState = {
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

export function undo() { StateManager.undo(); }
export function redo() { StateManager.redo(); }

/** Sync the undo/redo button enabled state with the history stacks.
 *  (Disabled appearance is handled by CSS `button:disabled`.) */
export function updateUndoButtons() {
  DOM.get('btn-undo').disabled = !StateManager.canUndo();
  DOM.get('btn-redo').disabled = !StateManager.canRedo();
}
