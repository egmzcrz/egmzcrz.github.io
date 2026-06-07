import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTripFromProfile,
  shiftService,
  setStationDwell
} from '../js/schedule.js';

// A→B→C: A,B stop; C is a pass-through terminus. Running times 4 and 3 min.
function sampleServiceData() {
  return {
    dir: {
      north: {
        order: [
          { name: 'A', km: 0, stop: true },
          { name: 'B', km: 5, stop: true },
          { name: 'C', km: 10, stop: false }
        ],
        runTime: [4, 3]
      }
    }
  };
}

test('buildTripFromProfile lays out arrivals, dwell and running time', () => {
  const svc = buildTripFromProfile(sampleServiceData(), 'north', 10, 2, 'key', 4);
  assert.equal(svc.serviceId, 4);
  assert.equal(svc.direction, 'north');
  assert.deepEqual(
    svc.times.map(t => [t.node, t.arr, t.dep]),
    [
      ['A', 10, 12], // arr 10, +2 dwell
      ['B', 16, 18], // 12 + 4 run, +2 dwell
      ['C', 21, 21] // 18 + 3 run, pass-through (no dwell)
    ]
  );
});

test('shiftService clamps so the earliest event never precedes midnight', () => {
  const svc = buildTripFromProfile(sampleServiceData(), 'north', 10, 2, 'key', 4);
  const applied = shiftService(svc, -25); // would push A to -15
  assert.equal(applied, -10); // clamped to bring min arr (10) to 0
  assert.equal(svc.times[0].arr, 0);
  assert.equal(svc.times[2].arr, 11);
});

test('shiftService moves the whole trip when unclamped', () => {
  const svc = buildTripFromProfile(sampleServiceData(), 'north', 10, 2, 'key', 4);
  assert.equal(shiftService(svc, 5), 5);
  assert.equal(svc.times[0].arr, 15);
  assert.equal(svc.times[1].dep, 23);
});

test('setStationDwell adjusts a stop dwell and propagates downstream', () => {
  const svc = buildTripFromProfile(sampleServiceData(), 'north', 10, 2, 'key', 4);
  setStationDwell(svc, 0, 5); // A dwell 2 → 5 (+3)
  assert.equal(svc.times[0].dep, 15);
  assert.equal(svc.times[1].arr, 19); // shifted +3
  assert.equal(svc.times[2].arr, 24);
});

test('setStationDwell is a no-op at pass-through stations', () => {
  const svc = buildTripFromProfile(sampleServiceData(), 'north', 10, 2, 'key', 4);
  const before = svc.times.map(t => ({ ...t }));
  setStationDwell(svc, 2, 5); // C is pass-through
  assert.deepEqual(svc.times, before);
});
