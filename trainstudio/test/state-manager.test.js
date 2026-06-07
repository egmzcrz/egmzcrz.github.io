import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../js/state-manager.js';

// The manager is a module singleton, so reset to a clean slate before each test.
function reset() {
  StateManager.loadServices({});
}

function samplePlan(id = 'p1') {
  return {
    id,
    name: 'Plan',
    serviceKey: 'k',
    headwayMin: 15,
    direction: 'north',
    color: '#000',
    visible: true,
    services: [
      { serviceId: 2, direction: 'north', serviceKey: 'k', times: [
        { node: 'A', arr: 0, dep: 0, km: 0, stop: true },
        { node: 'B', arr: 10, dep: 10, km: 5, stop: true }
      ] }
    ]
  };
}

test('addServicePlan appends, advances the color cursor, and enables undo', () => {
  reset();
  assert.equal(StateManager.canUndo(), false);
  StateManager.addServicePlan(samplePlan());
  assert.equal(StateManager.state.servicePlans.length, 1);
  assert.equal(StateManager.state.planColorIndex, 1);
  assert.equal(StateManager.canUndo(), true);
});

test('undo and redo move between document states', () => {
  reset();
  StateManager.addServicePlan(samplePlan());
  StateManager.undo();
  assert.equal(StateManager.state.servicePlans.length, 0);
  assert.equal(StateManager.canRedo(), true);
  StateManager.redo();
  assert.equal(StateManager.state.servicePlans.length, 1);
});

test('mutateService snapshots before mutating, so undo reverts the edit', () => {
  reset();
  StateManager.addServicePlan(samplePlan());
  StateManager.mutateService('p1', 0, svc => { svc.times[0].arr = 99; });
  assert.equal(StateManager.state.servicePlans[0].services[0].times[0].arr, 99);
  StateManager.undo();
  assert.equal(StateManager.state.servicePlans[0].services[0].times[0].arr, 0);
});

test('snapshots are deep-cloned: later mutations never leak into history', () => {
  reset();
  StateManager.addServicePlan(samplePlan());
  // Push a snapshot (of the current state), then mutate the live times.
  StateManager.beginTimeEdit();
  StateManager.state.servicePlans[0].services[0].times[0].arr = 42;
  StateManager.endTimeEdit();
  // Undo restores the pre-edit snapshot — which must be independent of the
  // object we just mutated.
  StateManager.undo();
  assert.equal(StateManager.state.servicePlans[0].services[0].times[0].arr, 0);
});

test('mutateService is a no-op for unknown plan/service ids', () => {
  reset();
  StateManager.addServicePlan(samplePlan());
  StateManager.mutateService('nope', 0, () => { throw new Error('should not run'); });
  assert.equal(StateManager.canUndo(), true); // only the addServicePlan snapshot
});
