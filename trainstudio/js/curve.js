// =============================================================
// CURVE — Pure string-line geometry (no DOM / D3 dependency)
//
// Turns a trip's schedule + simulated dynamics into the [time, km]
// polyline that the chart draws, including the cross-corridor remap.
// Kept free of rendering concerns so it can be unit-tested directly.
// =============================================================

/**
 * Build the full high-resolution [time, km] polyline for a trip in the trip's
 * OWN geometry coordinates: the simulated segment shape (segPoly) placed at the
 * trip's station times, with a flat dwell segment at each stop. This is the
 * curved string-line reflecting real acceleration/deceleration.
 *
 * @param {Array<{arr,dep,km}>} times — the trip's per-station schedule.
 * @param {{segPoly: Array<Array<[number,number]>>}|null} dirData — simulated
 *        per-direction data (segPoly[k] is the curve for segment k→k+1), or null.
 * @returns {Array<[number, number]>} [timeMin, km] points.
 */
export function buildRawCurve(times, dirData) {
  const points = [];

  for (let k = 0; k < times.length; k++) {
    const st = times[k];
    points.push([st.arr, st.km]);
    if (st.dep > st.arr) points.push([st.dep, st.km]);

    if (dirData && k < times.length - 1) {
      const seg = dirData.segPoly[k];
      if (seg && seg.length > 2) {
        for (let j = 1; j < seg.length - 1; j++) {
          points.push([st.dep + seg[j][0], seg[j][1]]);
        }
      }
    }
  }
  return points;
}

/**
 * Remap a raw [time, ownKm] polyline into a different corridor's km coordinates
 * using the stations the trip SHARES with the corridor (matched by name) as
 * piecewise-linear anchors — so geometrically identical track plots identically.
 * Points outside the shared span are dropped; returns [] if fewer than two
 * stations are shared.
 *
 * @param {Array<[number,number]>} rawPoints — [time, ownKm] points.
 * @param {Array<{node,km}>} times — the trip's stations (own km + names).
 * @param {Object<string,number>} corridorPositions — corridor km by station name.
 * @returns {Array<[number,number]>} [time, corridorKm] points.
 */
export function remapToCorridor(rawPoints, times, corridorPositions) {
  const anchors = [];
  for (const st of times) {
    const kc = corridorPositions[st.node];
    if (kc !== undefined) anchors.push({ s: st.km, c: kc });
  }
  if (anchors.length < 2) return [];
  anchors.sort((a, b) => a.s - b.s);
  const sMin = anchors[0].s;
  const sMax = anchors[anchors.length - 1].s;

  const remap = s => {
    if (s < sMin || s > sMax) return null; // outside the shared section
    for (let i = 1; i < anchors.length; i++) {
      if (s <= anchors[i].s) {
        const a = anchors[i - 1], b = anchors[i];
        return b.s === a.s ? a.c : a.c + (s - a.s) / (b.s - a.s) * (b.c - a.c);
      }
    }
    return anchors[anchors.length - 1].c;
  };

  const points = [];
  for (const [t, s] of rawPoints) {
    const c = remap(s);
    if (c !== null) points.push([t, c]);
  }
  return points;
}

/**
 * Build the [time, km] polyline for a trip mapped into the current corridor.
 * When the trip is on the corridor's own geometry the raw curve is used
 * directly; otherwise it's remapped via shared stations.
 *
 * @param {{times: Array, serviceKey: string}} svc — the trip.
 * @param {Object|null} dirData — the trip's simulated per-direction data.
 * @param {boolean} onCorridor — whether the trip runs on the viewed corridor.
 * @param {Object<string,number>} corridorPositions — corridor km by station name.
 * @returns {Array<[number,number]>}
 */
export function buildServiceCurve(svc, dirData, onCorridor, corridorPositions) {
  const raw = buildRawCurve(svc.times, dirData);
  if (onCorridor) return raw;
  return remapToCorridor(raw, svc.times, corridorPositions);
}
