import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRawCurve, remapToCorridor, buildServiceCurve } from '../js/curve.js';

// A two-stop trip: depart Alpha at 0 (dwell to 1), run to Beta arriving at 10.
function trip() {
  return {
    serviceKey: 'geomA',
    times: [
      { node: 'Alpha', arr: 0, dep: 1, km: 0, stop: true },
      { node: 'Beta', arr: 10, dep: 10, km: 5, stop: true }
    ]
  };
}

test('buildRawCurve emits arr/dep points and inlines interior segment points', () => {
  const dirData = { segPoly: [[[0, 0], [2, 2.5], [9, 5]]] }; // [relMin, km] for Alpha→Beta
  const pts = buildRawCurve(trip().times, dirData);
  // Alpha arr, Alpha dep, one interior point (endpoints of segPoly skipped), Beta arr.
  assert.deepEqual(pts[0], [0, 0]);   // Alpha arrival
  assert.deepEqual(pts[1], [1, 0]);   // Alpha departure (has dwell)
  assert.deepEqual(pts[2], [3, 2.5]); // interior: dep(1) + relMin(2) = 3
  assert.deepEqual(pts[pts.length - 1], [10, 5]); // Beta arrival
});

test('buildRawCurve omits the departure point when there is no dwell', () => {
  const t = trip();
  t.times[0].dep = t.times[0].arr; // no dwell at Alpha
  const pts = buildRawCurve(t.times, null);
  assert.deepEqual(pts, [[0, 0], [10, 5]]);
});

test('remapToCorridor scales own-km to corridor-km via shared stations', () => {
  // Corridor places Alpha at km 100 and Beta at km 110 → own 0..5 maps to 100..110.
  const corridorPositions = { Alpha: 100, Beta: 110 };
  const raw = [[0, 0], [5, 2.5], [10, 5]];
  const out = remapToCorridor(raw, trip().times, corridorPositions);
  assert.deepEqual(out, [[0, 100], [5, 105], [10, 110]]);
});

test('remapToCorridor drops points outside the shared span', () => {
  const corridorPositions = { Alpha: 0, Beta: 5 };
  const raw = [[0, -1], [1, 2.5], [2, 6]]; // first/last outside [0,5]
  const out = remapToCorridor(raw, trip().times, corridorPositions);
  assert.deepEqual(out, [[1, 2.5]]);
});

test('remapToCorridor returns [] when fewer than two stations are shared', () => {
  const out = remapToCorridor([[0, 0]], trip().times, { Alpha: 100 });
  assert.deepEqual(out, []);
});

test('buildServiceCurve returns the raw curve when on the trip own corridor', () => {
  const dirData = { segPoly: [[[0, 0], [9, 5]]] };
  const out = buildServiceCurve(trip(), dirData, true, {});
  assert.deepEqual(out, buildRawCurve(trip().times, dirData));
});

test('buildServiceCurve remaps when viewing a different corridor', () => {
  const dirData = { segPoly: [[[0, 0], [9, 5]]] };
  const out = buildServiceCurve(trip(), dirData, false, { Alpha: 0, Beta: 10 });
  // Beta arrival km doubled (own 5 → corridor 10).
  assert.deepEqual(out[out.length - 1], [10, 10]);
});
