// =============================================================
// DYNAMICS — Geometry/rolling-stock parsing + simulation pipeline
//
// Turns a track-geometry CSV and a rolling-stock YAML into a
// "serviceData" object: the ordered station list (Y-axis nodes), and,
// for each travel direction, the dwell-free running times and the
// high-resolution distance-vs-time curve between consecutive stations.
//
// Geometry CSV columns (positional, header row ignored):
//   0: pk_m              distance along track [m]
//   1: vel_kmh           speed limit [km/h]
//   2: curve_m           curve radius [m] (0 = straight)
//   3: slope_perthousand grade [‰]
//   4: station           station name ("" / "nan" = none)
//   5: stop              optional: whether the train HALTS here.
//                        Defaults to "stop" when a name is present.
//                        A named station with stop=0 is a plotted node
//                        the train passes through without stopping.
// =============================================================
import { KMH_TO_MS, SIM_PPKM, PLOT_MAX_SEG_POINTS } from './constants.js';
import { Engine } from './engine.js';

export const Dynamics = (function() {
  'use strict';

  // ---- Rolling stock (YAML) ----
  function parseTrainYaml(yamlText) {
    const data = jsyaml.load(yamlText);
    if (!data || !data.tractive_effort_table || !data.braking_curve_table) {
      throw new Error('Rolling-stock YAML missing tractive_effort_table or braking_curve_table');
    }
    return {
      name: data.name || 'Train',
      mass: data.mass,
      adh_mass: data.adh_mass,
      rotational_inertia: data.rotational_inertia,
      davis_a: data.davis_a,
      davis_b: data.davis_b,
      davis_c: data.davis_c,
      trac_v: data.tractive_effort_table.map(r => r[0] * KMH_TO_MS),
      trac_f: data.tractive_effort_table.map(r => r[1]),
      brake_v: data.braking_curve_table.map(r => r[0] * KMH_TO_MS),
      brake_a: data.braking_curve_table.map(r => r[1])
    };
  }

  // ---- Geometry (CSV) ----
  function isValidStation(name) {
    return name !== '' && name.toLowerCase() !== 'nan';
  }

  function parseStopFlag(raw, hasStation) {
    if (!hasStation) return false;
    if (raw === undefined || raw === null) return true;
    const s = raw.toString().trim().toLowerCase();
    if (s === '') return true; // named, flag omitted → stops (trainrun semantics)
    return !(s === '0' || s === 'false' || s === 'no' ||
             s === 'pass' || s === 'passthrough' || s === 'through' || s === 'skip');
  }

  /**
   * Split one CSV line into fields, honoring double-quoted fields (which may
   * contain commas or escaped "" quotes). Good enough for the simple,
   * single-line records this geometry format uses.
   */
  function splitCsvLine(line) {
    const fields = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"') {
          if (line[i + 1] === '"') { field += '"'; i++; } // escaped quote
          else inQuotes = false;
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        fields.push(field);
        field = '';
      } else {
        field += c;
      }
    }
    fields.push(field);
    return fields;
  }

  /** Parse the raw CSV rows into geometry points (forward order). */
  function parseGeometryCsv(csvText) {
    const lines = csvText.trim().split('\n').filter(l => l.trim() !== '');
    if (lines.length < 2) throw new Error('Geometry CSV is empty');
    lines.shift(); // drop header

    const rows = lines.map(line => {
      const p = splitCsvLine(line);
      const name = p[4] !== undefined ? p[4].trim() : '';
      const hasSt = isValidStation(name);
      return {
        x: parseFloat(p[0]),               // metres
        vlim: parseFloat(p[1]) * KMH_TO_MS, // m/s
        curve: parseFloat(p[2]) || 0,
        slope: parseFloat(p[3]) || 0,
        station: hasSt ? name : '',
        stop: parseStopFlag(p[5], hasSt)
      };
    }).filter(r => !isNaN(r.x) && !isNaN(r.vlim));

    if (rows.length < 2) throw new Error('Geometry CSV has too few valid rows');
    if (!rows.some(r => r.station)) {
      throw new Error('Geometry CSV has no named stations');
    }
    return rows;
  }

  /**
   * Build the spatially-discretised path arrays for one travel direction.
   * Returns parallel arrays for the engine plus station markers (in travel
   * order) carrying the sample index and real (forward-coordinate) km.
   */
  function buildPath(rows, ppkm, reversed) {
    let pos = [], vlim = [], slope = [], curve = [], isStation = [], dwell = [];
    const markers = []; // { name, km, stop, idx } in forward sample space

    for (let i = 0; i < rows.length - 1; i++) {
      const cur = rows[i], nxt = rows[i + 1];
      if (cur.station) markers.push({ name: cur.station, km: cur.x / 1000, stop: cur.stop, idx: pos.length });

      const dx = nxt.x - cur.x;
      const nPoints = Math.max(1, Math.ceil(dx * (ppkm / 1000)));
      const step = dx / nPoints;
      for (let j = 0; j < nPoints; j++) {
        pos.push(cur.x + j * step);
        vlim.push(cur.vlim);
        curve.push(cur.curve);
        slope.push(cur.slope);
        isStation.push(0); // mask is applied per-station below, NOT per-segment
        dwell.push(0);
      }
    }

    // Final point
    const last = rows[rows.length - 1];
    if (last.station) markers.push({ name: last.station, km: last.x / 1000, stop: last.stop, idx: pos.length });
    pos.push(last.x);
    vlim.push(last.vlim);
    curve.push(last.curve);
    slope.push(last.slope);
    isStation.push(0);
    dwell.push(0);

    const N = pos.length;
    // A STOP is a SINGLE forced-rest sample at the station's own position, so
    // the train decelerates into it and accelerates out. A pass-through
    // (stop=false) named station carries NO mask, so the train keeps its
    // speed through it (it is only a plotted node). Termini are at rest.
    for (const m of markers) {
      if (m.stop) isStation[m.idx] = 1;
    }
    isStation[0] = 1;
    isStation[N - 1] = 1;

    let kmReal;
    if (!reversed) {
      kmReal = pos.map(x => x / 1000);
    } else {
      // Mirror the geometry for the physics run (matches trainrun): the
      // train travels from the far end back to the origin, so slopes and
      // curves flip sign and the arrays reverse. The traveled coordinate
      // `pos` runs 0..L again; real km = (offset - pos)/1000.
      const offset = pos[N - 1] + pos[0];
      pos = pos.map(x => offset - x).reverse();
      vlim = vlim.reverse();
      slope = slope.map(s => -s).reverse();
      curve = curve.map(c => -c).reverse();
      isStation = isStation.reverse();
      dwell = dwell.reverse();
      kmReal = pos.map(x => (offset - x) / 1000);
      // Re-index station markers into reversed sample space, travel order.
      for (const m of markers) m.idx = N - 1 - m.idx;
      markers.reverse();
    }

    return { pos, vlim, slope, curve, is_station: isStation, dwell, kmReal, markers };
  }

  /** Uniformly downsample a [t, km] polyline to at most `max` points. */
  function downsample(seg, max) {
    if (seg.length <= max) return seg;
    const stride = Math.ceil(seg.length / max);
    const out = [];
    for (let i = 0; i < seg.length; i += stride) out.push(seg[i]);
    if (out[out.length - 1] !== seg[seg.length - 1]) out.push(seg[seg.length - 1]);
    return out;
  }

  /**
   * Extract per-direction running data from a simulated path:
   *   order    — stations in travel order [{ name, km, stop }]
   *   runTime  — dwell-free running time [min] for each segment k→k+1
   *   segPoly  — high-res [relMin, km] polyline for each segment k→k+1
   *              (relMin from 0 at station k to runTime[k] at station k+1)
   */
  function extractDirection(path, sim) {
    const timeMin = sim.time.map(t => t / 60);
    const km = path.kmReal;
    const markers = path.markers;

    const order = markers.map(m => ({ name: m.name, km: m.km, stop: m.stop }));
    const runTime = [];
    const segPoly = [];

    for (let k = 0; k < markers.length - 1; k++) {
      const i0 = markers[k].idx;
      const i1 = markers[k + 1].idx;
      const t0 = timeMin[i0];
      const seg = [];
      for (let i = i0; i <= i1; i++) seg.push([timeMin[i] - t0, km[i]]);
      runTime.push(timeMin[i1] - t0);
      segPoly.push(downsample(seg, PLOT_MAX_SEG_POINTS));
    }

    return { order, runTime, segPoly };
  }

  /**
   * Full pipeline: CSV + YAML → serviceData.
   * @returns {{
   *   nodes: Array<{name,km}>, positions: Object, length: number,
   *   stations: Array<{name,km,stop}>,
   *   trainName: string,
   *   dir: { north: {order,runTime,segPoly}, south: {...} }
   * }}
   */
  function simulate(csvText, yamlText) {
    const train = parseTrainYaml(yamlText);
    const rows = parseGeometryCsv(csvText);

    const fwdPath = buildPath(rows, SIM_PPKM, false);
    const revPath = buildPath(rows, SIM_PPKM, true);
    const fwdSim = Engine.runSimulation(fwdPath, train);
    const revSim = Engine.runSimulation(revPath, train);

    const north = extractDirection(fwdPath, fwdSim);
    const south = extractDirection(revPath, revSim);

    // Y-axis nodes: forward station order (increasing km).
    const stations = north.order.map(s => ({ name: s.name, km: s.km, stop: s.stop }));
    const positions = {};
    stations.forEach(s => { positions[s.name] = s.km; });
    const length = stations.reduce((mx, s) => Math.max(mx, s.km), -Infinity);

    return {
      nodes: stations.map(s => ({ name: s.name, km: s.km })),
      positions,
      stations,
      length,
      trainName: train.name,
      dir: { north, south }
    };
  }

  return { simulate, parseTrainYaml, parseGeometryCsv };
})();
