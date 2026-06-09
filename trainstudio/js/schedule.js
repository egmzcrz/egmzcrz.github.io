import { DEFAULT_BLOCK_LENGTH_M } from './constants.js';

// =============================================================
// SCHEDULE MODEL — Trip construction & edit primitives
//
// Trips are derived from the simulated dynamics: the running time
// between consecutive stations is FIXED by physics. The only editable
// quantities are therefore (a) when the trip starts (whole-trip shift)
// and (b) the dwell at each stop-station. Edits propagate forward so
// running times always stay consistent with the simulation.
// =============================================================

/**
 * Build a single trip's station schedule from the simulated profile.
 *
 * @param {Object} serviceData — entry in STATE.services (has .dir[direction]).
 * @param {string} direction — 'north' or 'south'.
 * @param {number} startOffsetMin — departure time from the first station.
 * @param {number} dwellMin — dwell applied at every stop-station.
 * @param {string} serviceKey — key into STATE.services (stored on the trip).
 * @param {number} serviceId — display id.
 * @param {number} [blockLengthM] — initial signaling-block length (metres).
 * @returns {{serviceId, direction, serviceKey, times: Array<{node,arr,dep,km,stop}>}}
 */
export function buildTripFromProfile(serviceData, direction, startOffsetMin, dwellMin, serviceKey, serviceId, blockLengthM = DEFAULT_BLOCK_LENGTH_M) {
  const dir = serviceData.dir[direction];
  const order = dir.order;
  const runTime = dir.runTime;

  const times = [];
  let t = startOffsetMin;
  for (let k = 0; k < order.length; k++) {
    const st = order[k];
    const arr = t;
    const dwell = st.stop ? dwellMin : 0;
    const dep = arr + dwell;
    times.push({ node: st.name, arr, dep, km: st.km, stop: st.stop });
    if (k < order.length - 1) t = dep + runTime[k];
  }

  // Signaling blocks are a per-service overlay (off by default). blockLengthM
  // is the nominal block length used to subdivide inter-station gaps; it seeds
  // from the caller's sticky default (the last length the user chose).
  return { serviceId, direction, serviceKey, times, showBlocks: false, blockLengthM };
}

/**
 * Shift an entire trip in time by `delta` minutes (drag the line / edit an
 * arrival). Clamps so the earliest event never goes before midnight.
 * Returns the delta actually applied.
 */
export function shiftService(svc, delta) {
  const times = svc.times;
  let minArr = Infinity;
  for (const t of times) if (t.arr < minArr) minArr = t.arr;
  if (minArr + delta < 0) delta = -minArr;
  if (delta === 0) return 0;
  for (const t of times) { t.arr += delta; t.dep += delta; }
  return delta;
}

/**
 * Set the dwell at a stop-station and propagate the change to all later
 * events (running times downstream are preserved). No-op for pass-through
 * stations (they have no dwell). Dwell is clamped to >= 0.
 */
export function setStationDwell(svc, stationIdx, newDwellMin) {
  const times = svc.times;
  const entry = times[stationIdx];
  if (!entry || !entry.stop) return;
  const nd = Math.max(0, newDwellMin);
  const oldDwell = entry.dep - entry.arr;
  const delta = nd - oldDwell;
  if (Math.abs(delta) < 1e-9) return;
  entry.dep = entry.arr + nd;
  for (let k = stationIdx + 1; k < times.length; k++) {
    times[k].arr += delta;
    times[k].dep += delta;
  }
}
