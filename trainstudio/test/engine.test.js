import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../js/engine.js';

// Flat, straight 1 km track sampled every 10 m; rest at both ends.
function flatPath() {
  const pos = [];
  for (let x = 0; x <= 1000; x += 10) pos.push(x);
  const n = pos.length;
  const fill = v => new Array(n).fill(v);
  const is_station = fill(0);
  is_station[0] = 1;
  is_station[n - 1] = 1;
  return {
    pos,
    vlim: fill(30), // m/s
    slope: fill(0),
    curve: fill(0),
    is_station,
    dwell: fill(0)
  };
}

const TRAIN = {
  mass: 100000,
  adh_mass: 100000,
  rotational_inertia: 10,
  davis_a: 1.0,
  davis_b: 0,
  davis_c: 0,
  trac_v: [0, 50],
  trac_f: [300000, 300000],
  brake_v: [0, 50],
  brake_a: [1.0, 1.0]
};

test('runSimulation returns parallel arrays of the right length', () => {
  const path = flatPath();
  const sim = Engine.runSimulation(path, TRAIN);
  const n = path.pos.length;
  for (const key of ['v', 'time', 'energy', 'force']) {
    assert.equal(sim[key].length, n, `${key} length`);
    assert.ok(sim[key].every(Number.isFinite), `${key} all finite`);
  }
});

test('train starts and ends at rest', () => {
  const sim = Engine.runSimulation(flatPath(), TRAIN);
  assert.equal(sim.v[0], 0);
  assert.equal(sim.v[sim.v.length - 1], 0);
});

test('time is zero at start and strictly increasing', () => {
  const sim = Engine.runSimulation(flatPath(), TRAIN);
  assert.equal(sim.time[0], 0);
  for (let i = 1; i < sim.time.length; i++) {
    assert.ok(sim.time[i] > sim.time[i - 1], `time increases at ${i}`);
  }
});

test('train accelerates away from the stop (mid-track speed > 0)', () => {
  const sim = Engine.runSimulation(flatPath(), TRAIN);
  const mid = Math.floor(sim.v.length / 2);
  assert.ok(sim.v[mid] > 0);
  assert.ok(sim.v[mid] <= 30 + 1e-9, 'never exceeds the speed limit');
});

test('dwell at the final station adds to total time', () => {
  const base = Engine.runSimulation(flatPath(), TRAIN);
  const path = flatPath();
  path.dwell[path.dwell.length - 1] = 60; // 60 s dwell at terminus
  const withDwell = Engine.runSimulation(path, TRAIN);
  const last = path.pos.length - 1;
  assert.ok(Math.abs(withDwell.time[last] - base.time[last] - 60) < 1e-6);
});
