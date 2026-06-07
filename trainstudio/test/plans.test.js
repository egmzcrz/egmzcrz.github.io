import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../js/state-manager.js';
import { createServicePlan } from '../js/plans.js';

// Minimal simulated service data: two stations, both directions.
function fakeServiceData() {
  const north = {
    order: [
      { name: 'A', km: 0, stop: true },
      { name: 'B', km: 5, stop: true }
    ],
    runTime: [10],
    segPoly: [[[0, 0], [10, 5]]]
  };
  const south = {
    order: [
      { name: 'B', km: 5, stop: true },
      { name: 'A', km: 0, stop: true }
    ],
    runTime: [10],
    segPoly: [[[0, 5], [10, 0]]]
  };
  return { nodes: north.order, positions: { A: 0, B: 5 }, length: 5, dir: { north, south } };
}

// headway 1440 with offset 0 yields exactly two departures (t=0 and t=1440)
// per direction, keeping the id sequence small and predictable.
function buildBoth(name) {
  return createServicePlan(name, 'k', 1440, 0, 0, 'both', '#000');
}

test('createServicePlan assigns even ids to north and odd ids to south', () => {
  StateManager.loadServices({ k: fakeServiceData() });
  const plan = buildBoth('P1');
  const ids = plan.services.map(s => ({ dir: s.direction, id: s.serviceId }));
  assert.deepEqual(ids, [
    { dir: 'north', id: 2 },
    { dir: 'south', id: 1 },
    { dir: 'north', id: 4 },
    { dir: 'south', id: 3 }
  ]);
});

test('createServicePlan keeps ids unique across multiple plans', () => {
  StateManager.loadServices({ k: fakeServiceData() });
  const p1 = buildBoth('P1');
  StateManager.addServicePlan(p1);
  const p2 = buildBoth('P2');

  const allIds = [...p1.services, ...p2.services].map(s => s.serviceId);
  assert.equal(new Set(allIds).size, allIds.length, 'no duplicate service ids');
  // North stays even, south stays odd in the second plan too.
  for (const s of p2.services) {
    assert.equal(s.serviceId % 2, s.direction === 'north' ? 0 : 1);
  }
});

test('createServicePlan returns null for an unknown service key', () => {
  StateManager.loadServices({ k: fakeServiceData() });
  assert.equal(createServicePlan('X', 'missing', 15, 0, 0, 'both', '#000'), null);
});
