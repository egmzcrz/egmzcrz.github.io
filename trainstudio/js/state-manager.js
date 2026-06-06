// =============================================================
// STATE MANAGER — Encapsulated state, undo/redo, pub/sub
// =============================================================
const StateManager = (function() {
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
    timeFilterEnd: null
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
  function _snapshot() {
    return {
      servicePlans: _state.servicePlans.map(p => ({
        ...p,
        services: p.services.map(s => ({
          ...s,
          times: s.times.map(t => ({ ...t }))
        }))
      })),
      selectedService: _state.selectedService ? { ..._state.selectedService } : null,
      planColorIndex: _state.planColorIndex,
      timeFilterStart: _state.timeFilterStart,
      timeFilterEnd: _state.timeFilterEnd
    };
  }

  function _restore(snap) {
    _state.servicePlans = snap.servicePlans;
    _state.selectedService = snap.selectedService;
    _state.planColorIndex = snap.planColorIndex;
    _state.timeFilterStart = snap.timeFilterStart;
    _state.timeFilterEnd = snap.timeFilterEnd;
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

  /** 
   * Begin a time-edit session (drag or text edit).
   * Pushes one undo snapshot. Caller mutates svc.times directly,
   * then calls endTimeEdit() to notify.
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
    setCorridorView,
    addServicePlan,
    removeServicePlan,
    setPlanColor,
    togglePlanVisibility,
    selectService,
    deselectService,
    deleteService,
    setTimeFilter,
    clearTimeFilter,
    beginTimeEdit,
    endTimeEdit,

    // Undo/redo
    undo,
    redo,
    canUndo,
    canRedo,

    // Snapshot (for drag operations that need manual control)
    snapshot: _snapshot,
    restore: _restore
  };
})();
