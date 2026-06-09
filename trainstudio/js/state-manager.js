// =============================================================
// STATE MANAGER — Encapsulated state, undo/redo, pub/sub
// =============================================================
export const StateManager = (function() {
  'use strict';

  // ---- Internal state ----
  const _state = {
    services: {},
    corridorView: null,
    servicePlans: [],
    selectedService: null,
    planColorIndex: 0,
    undoStack: [],
    redoStack: [],
    maxUndo: 50,
    timeFilterStart: null,
    timeFilterEnd: null,
    // Signaling-block overlay (view state, like the time filter — not undone).
    blockLengthM: 500,
    showBlocks: false
  };

  const _listeners = [];

  // ---- Subscriber system ----
  function onChange(fn) {
    _listeners.push(fn);
    return function unsubscribe() {
      const idx = _listeners.indexOf(fn);
      if (idx >= 0) _listeners.splice(idx, 1);
    };
  }

  function _notify() {
    for (let i = 0; i < _listeners.length; i++) {
      _listeners[i]();
    }
  }

  // ---- Snapshot / Restore ----
  // Undo history covers the document (plans, selection, color cursor) only.
  // The time filter is view state — like zoom/pan — and is deliberately
  // excluded so undo/redo never silently changes what's filtered.
  function _snapshot() {
    return {
      // servicePlans hold only plain data (no functions/DOM), so a structured
      // clone deep-copies them safely without hand-rolled nested maps.
      servicePlans: structuredClone(_state.servicePlans),
      selectedService: _state.selectedService ? { ..._state.selectedService } : null,
      planColorIndex: _state.planColorIndex
    };
  }

  function _restore(snap) {
    _state.servicePlans = snap.servicePlans;
    _state.selectedService = snap.selectedService;
    _state.planColorIndex = snap.planColorIndex;
  }

  function _pushUndo() {
    _state.undoStack.push(_snapshot());
    if (_state.undoStack.length > _state.maxUndo) _state.undoStack.shift();
    _state.redoStack = [];
  }

  // ---- Public API ----

  /** Load services from Excel parser. Resets all plans. */
  function loadServices(services) {
    _state.services = services;
    _state.corridorView = Object.keys(services)[0] || null;
    _state.servicePlans = [];
    _state.selectedService = null;
    _state.planColorIndex = 0;
    _state.undoStack = [];
    _state.redoStack = [];
    _state.timeFilterStart = null;
    _state.timeFilterEnd = null;
    _notify();
  }

  /**
   * Register a simulated geometry+rolling-stock as a selectable service
   * (corridor). Reuses the entry if the key already exists (cached sim).
   * Does not touch existing plans or undo history.
   */
  function registerService(key, serviceData) {
    _state.services[key] = serviceData;
    if (!_state.corridorView) _state.corridorView = key;
    _notify();
  }

  /** Switch corridor view (Y-axis). */
  function setCorridorView(key) {
    _state.corridorView = key;
    _notify();
  }

  /** Add a new service plan. Pushes undo automatically. */
  function addServicePlan(plan) {
    _pushUndo();
    _state.servicePlans.push(plan);
    _state.planColorIndex++;
    _notify();
  }

  /** Remove a service plan by id. Pushes undo automatically. */
  function removeServicePlan(planId) {
    _pushUndo();
    if (_state.selectedService && _state.selectedService.planId === planId) {
      _state.selectedService = null;
    }
    _state.servicePlans = _state.servicePlans.filter(p => p.id !== planId);
    // If the corridor being viewed is no longer used by any remaining plan,
    // switch to one that is (or clear it when no plans are left).
    const usedKeys = new Set(_state.servicePlans.map(p => p.serviceKey));
    if (_state.corridorView && !usedKeys.has(_state.corridorView)) {
      _state.corridorView = _state.servicePlans.length ? _state.servicePlans[0].serviceKey : null;
    }
    _notify();
  }

  /** Rename a service plan. Pushes undo automatically. */
  function setPlanName(planId, name) {
    const plan = _state.servicePlans.find(p => p.id === planId);
    if (!plan || plan.name === name) return;
    _pushUndo();
    plan.name = name;
    _notify();
  }

  /** Change a plan's line color. Pushes undo automatically. */
  function setPlanColor(planId, color) {
    const plan = _state.servicePlans.find(p => p.id === planId);
    if (!plan || plan.color === color) return;
    _pushUndo();
    plan.color = color;
    _notify();
  }

  /** Toggle a plan's visibility. No undo (reversible by toggling again). */
  function togglePlanVisibility(planId) {
    const plan = _state.servicePlans.find(p => p.id === planId);
    if (plan) {
      plan.visible = !plan.visible;
      _notify();
    }
  }

  /** Select a specific service for detail view. */
  function selectService(planId, serviceIndex) {
    _state.selectedService = { planId, serviceIndex };
    _notify();
  }

  /** Deselect the currently selected service. */
  function deselectService() {
    if (_state.selectedService !== null) {
      _state.selectedService = null;
      _notify();
    }
  }

  /** Delete a single service from a plan. Pushes undo automatically. */
  function deleteService(planId, serviceIndex) {
    _pushUndo();
    const plan = _state.servicePlans.find(p => p.id === planId);
    if (plan) {
      plan.services.splice(serviceIndex, 1);
    }
    _state.selectedService = null;
    _notify();
  }

  /** Set time filter range (in minutes from midnight). Pass null for auto. */
  function setTimeFilter(start, end) {
    _state.timeFilterStart = start;
    _state.timeFilterEnd = end;
    _notify();
  }

  /** Clear the time filter (auto-range). */
  function clearTimeFilter() {
    _state.timeFilterStart = null;
    _state.timeFilterEnd = null;
    _notify();
  }

  /** Set the global signaling-block length (metres). No undo (view state). */
  function setBlockLength(metres) {
    const v = Math.max(1, Math.round(Number(metres) || 0));
    if (_state.blockLengthM === v) return;
    _state.blockLengthM = v;
    _notify();
  }

  /** Toggle the signaling-block overlay on/off. No undo (view state). */
  function setShowBlocks(show) {
    show = !!show;
    if (_state.showBlocks === show) return;
    _state.showBlocks = show;
    _notify();
  }

  /**
   * Apply a discrete edit to a single trip through the manager: snapshots for
   * undo, runs the mutator on the trip, then notifies. Preferred over the
   * begin/end bracket for one-shot edits so the snapshot can't be forgotten.
   * @param {string} planId
   * @param {number} serviceIndex
   * @param {(svc: Object) => void} mutator — mutates svc.times in place.
   */
  function mutateService(planId, serviceIndex, mutator) {
    const plan = _state.servicePlans.find(p => p.id === planId);
    if (!plan) return;
    const svc = plan.services[serviceIndex];
    if (!svc) return;
    _pushUndo();
    mutator(svc);
    _notify();
  }

  /**
   * Begin a continuous time-edit session (live drag). Pushes one undo
   * snapshot; the caller mutates svc.times directly across many frames and
   * calls endTimeEdit() once when the drag ends. (For one-shot edits use
   * mutateService instead.)
   */
  function beginTimeEdit() {
    _pushUndo();
  }

  /** End a time-edit session. Notifies subscribers to re-render. */
  function endTimeEdit() {
    _notify();
  }

  /** Undo last action. */
  function undo() {
    if (_state.undoStack.length === 0) return;
    _state.redoStack.push(_snapshot());
    _restore(_state.undoStack.pop());
    _notify();
  }

  /** Redo last undone action. */
  function redo() {
    if (_state.redoStack.length === 0) return;
    _state.undoStack.push(_snapshot());
    _restore(_state.redoStack.pop());
    _notify();
  }

  /** Whether undo is available. */
  function canUndo() {
    return _state.undoStack.length > 0;
  }

  /** Whether redo is available. */
  function canRedo() {
    return _state.redoStack.length > 0;
  }

  // ---- Expose ----
  return {
    // Access the raw state (for reads and D3 drag mutations)
    state: _state,

    // Subscription
    onChange,

    // Mutations
    loadServices,
    registerService,
    setCorridorView,
    addServicePlan,
    removeServicePlan,
    setPlanName,
    setPlanColor,
    togglePlanVisibility,
    selectService,
    deselectService,
    deleteService,
    setTimeFilter,
    clearTimeFilter,
    setBlockLength,
    setShowBlocks,
    mutateService,
    beginTimeEdit,
    endTimeEdit,

    // Undo/redo
    undo,
    redo,
    canUndo,
    canRedo
  };
})();
