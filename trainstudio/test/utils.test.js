import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, formatTimeHMS, formatTimeHM, formatDuration, parseTimeHHMM } from '../js/utils.js';

test('escapeHtml neutralizes HTML metacharacters', () => {
  assert.equal(escapeHtml('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
  assert.equal(escapeHtml("o'reilly"), 'o&#39;reilly');
  assert.equal(escapeHtml(42), '42');
});

test('formatTimeHMS formats minutes-from-midnight', () => {
  assert.equal(formatTimeHMS(0), '00:00:00');
  assert.equal(formatTimeHMS(390), '06:30:00');
  assert.equal(formatTimeHMS(90.5), '01:30:30');
  // hours may exceed 23 for times past midnight
  assert.equal(formatTimeHMS(1500), '25:00:00');
});

test('formatTimeHM formats minutes as HH:MM (hours may exceed 23)', () => {
  assert.equal(formatTimeHM(0), '00:00');
  assert.equal(formatTimeHM(390), '06:30');
  assert.equal(formatTimeHM(1500), '25:00');
});

test('formatDuration formats minutes as "Mm SSs"', () => {
  assert.equal(formatDuration(0), '0m 00s');
  assert.equal(formatDuration(1.5), '1m 30s');
  assert.equal(formatDuration(10), '10m 00s');
});

test('parseTimeHHMM accepts HH:MM and HH:MM:SS', () => {
  assert.equal(parseTimeHHMM('06:30'), 390);
  assert.equal(parseTimeHHMM('14:05:30'), 14 * 60 + 5 + 0.5);
  assert.equal(parseTimeHHMM('25:00'), 1500);
  assert.equal(parseTimeHHMM('  06:30  '), 390);
});

test('parseTimeHHMM rejects malformed / out-of-range input', () => {
  for (const bad of ['', 'abc', '12', '12abc:30', '12:99', '12:30:99', '12:3a', '1:2:3:4']) {
    assert.ok(Number.isNaN(parseTimeHHMM(bad)), `expected NaN for ${JSON.stringify(bad)}`);
  }
});

test('formatTimeHMS and parseTimeHHMM round-trip', () => {
  for (const m of [0, 390, 723, 1439]) {
    assert.equal(parseTimeHHMM(formatTimeHMS(m)), m);
  }
});
