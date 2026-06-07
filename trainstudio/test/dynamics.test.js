import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Dynamics } from '../js/dynamics.js';

const { parseGeometryCsv } = Dynamics;

const HEADER = 'pk_m,vel_kmh,curve_m,slope_perthousand,station,stop\n';

test('parseGeometryCsv reads positional columns and km/speed', () => {
  const rows = parseGeometryCsv(HEADER + '0,100,0,0,Alpha,\n1000,80,0,5,Beta,\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].x, 0);
  assert.equal(rows[0].station, 'Alpha');
  assert.equal(rows[1].slope, 5);
  // 100 km/h → m/s
  assert.ok(Math.abs(rows[0].vlim - 100 / 3.6) < 1e-9);
});

test('parseGeometryCsv defaults a named station to stop=true and honors flags', () => {
  const rows = parseGeometryCsv(
    HEADER +
      '0,100,0,0,Alpha,\n' + // named, flag omitted → stops
      '500,100,0,0,Beta,0\n' + // explicit pass-through
      '900,100,0,0,Gamma,pass\n' + // textual pass-through
      '1000,100,0,0,Delta,1\n'
  );
  assert.equal(rows[0].stop, true);
  assert.equal(rows[1].stop, false);
  assert.equal(rows[2].stop, false);
  assert.equal(rows[3].stop, true);
});

test('parseGeometryCsv handles quoted station names containing commas', () => {
  const rows = parseGeometryCsv(HEADER + '0,100,0,0,"Smith, Junction",\n1000,100,0,0,End,\n');
  assert.equal(rows[0].station, 'Smith, Junction');
  assert.equal(rows[0].stop, true);
});

test('parseGeometryCsv treats blank/nan station as none', () => {
  const rows = parseGeometryCsv(HEADER + '0,100,0,0,,\n500,100,0,0,nan,\n1000,100,0,0,End,\n');
  assert.equal(rows[0].station, '');
  assert.equal(rows[1].station, '');
  assert.equal(rows[2].station, 'End');
});

test('parseGeometryCsv rejects empty or station-less input', () => {
  assert.throws(() => parseGeometryCsv(HEADER), /empty/i);
  assert.throws(() => parseGeometryCsv(HEADER + '0,100,0,0,,\n1000,100,0,0,,\n'), /no named stations/i);
});
