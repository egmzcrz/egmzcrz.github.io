// =============================================================
// PHYSICS ENGINE — Pure-JS port of trainrun's engine.c
//
// Forward/backward-pass train dynamics simulation. Given a spatial
// discretisation of the track (positions, speed limits, slopes,
// curves, station stop-mask, dwell) and a rolling-stock definition,
// it returns the speed, cumulative time, energy and force profiles.
//
// All inputs/outputs are SI: positions [m], speeds [m/s], time [s],
// forces [N], energy [J]. Mirrors engine.c exactly so results match
// the original WASM simulator.
// =============================================================
import { G, MS_TO_KMH } from './constants.js';

export const Engine = (function() {
  'use strict';

  function effectiveMass(mass, rotInertia) {
    return mass * (1.0 + 0.01 * rotInertia);
  }

  function rollingResistance(mass, v, a, b, c) {
    const vKmh = v * MS_TO_KMH;
    return mass * G * (a + vKmh * (b + c * vKmh)) * 0.001;
  }

  function slopeResistance(mass, slope) {
    return mass * G * slope * 0.001;
  }

  function curveResistance(mass, curve) {
    const curv = Math.abs(curve);
    if (curv <= 0) return 0.0;
    let denom, specific;
    if (curv >= 300.0) {
      denom = Math.max(1.0, curv - 55.0);
      specific = 650.0 / denom;
    } else {
      denom = Math.max(1.0, curv - 30.0);
      specific = 500.0 / denom;
    }
    return mass * G * specific * 0.001;
  }

  function maxBrakingEffort(v, mass, adhMass, brakeV, brakeA) {
    const n = brakeV.length;
    let decel = brakeA[0];
    for (let i = 0; i < n; i++) {
      if (v < brakeV[i]) { decel = brakeA[i]; break; }
    }
    if (v >= brakeV[n - 1]) decel = brakeA[n - 1];

    const force = mass * decel;
    const friction = 0.161 + 2.1 / (v + 12.2);
    const weather = 1.25;
    const adhesionLimit = adhMass * G * friction * weather;
    return Math.min(force, adhesionLimit);
  }

  function maxTractiveEffort(v, mass, adhMass, tracV, tracF) {
    const n = tracV.length;
    let force = 0.0;
    if (v <= tracV[0]) {
      force = tracF[0];
    } else if (v >= tracV[n - 1]) {
      force = 0.0;
    } else {
      for (let i = 1; i < n; i++) {
        if (v < tracV[i]) {
          const v1 = tracV[i - 1], f1 = tracF[i - 1];
          const v2 = tracV[i], f2 = tracF[i];
          const p1 = f1 * v1, p2 = f2 * v2;
          const p = p1 + (p2 - p1) / (v2 - v1) * (v - v1);
          force = p / v;
          break;
        }
      }
    }
    const friction = 0.161 + 2.1 / (v + 12.2);
    const weather = 1.25;
    const adhesionLimit = adhMass * G * friction * weather;
    return Math.min(force, adhesionLimit);
  }

  /**
   * Run the simulation.
   *
   * @param {Object} path — { pos[m], vlim[m/s], slope[‰], curve[m],
   *                           is_station[0/1], dwell[s] } (parallel arrays)
   * @param {Object} train — { mass, adh_mass, rotational_inertia,
   *                            davis_a, davis_b, davis_c,
   *                            trac_v[m/s], trac_f[N],
   *                            brake_v[m/s], brake_a[m/s²] }
   * @returns {{ v:number[], time:number[], energy:number[], force:number[] }}
   *          v in m/s, time in s, energy in J, force in N.
   */
  function runSimulation(path, train) {
    const pos = path.pos;
    const vlim = path.vlim;
    const slope = path.slope;
    const curve = path.curve;
    const stationMask = path.is_station;
    const dwell = path.dwell;
    const n = pos.length;

    const mass = train.mass;
    const adhMass = train.adh_mass;
    const rotInertia = train.rotational_inertia;
    const da = train.davis_a, db = train.davis_b, dc = train.davis_c;
    const tracV = train.trac_v, tracF = train.trac_f;
    const brakeV = train.brake_v, brakeA = train.brake_a;
    const vTrainLim = tracV[tracV.length - 1];

    const vFwd = new Float64Array(n);
    const vBwd = new Float64Array(n);
    const outV = new Float64Array(n);
    const outTime = new Float64Array(n);
    const outEnergy = new Float64Array(n);
    const outForce = new Float64Array(n);

    // ---- Forward pass ----
    vFwd[0] = 0.0;
    for (let i = 0; i < n - 1; i++) {
      const vCurr = vFwd[i];
      const Ft = maxTractiveEffort(vCurr, mass, adhMass, tracV, tracF);
      const Rroll = rollingResistance(mass, vCurr, da, db, dc);
      const Rslope = slopeResistance(mass, slope[i]);
      const Rcurve = curveResistance(mass, curve[i]);

      const Fnet = Ft - Rroll - Rslope - Rcurve;
      const a = Fnet / effectiveMass(mass, rotInertia);

      const ds = pos[i + 1] - pos[i];
      const vNextSq = vCurr * vCurr + 2 * a * ds;
      const vNext = vNextSq > 0 ? Math.sqrt(vNextSq) : 0.0;
      const vTrackLim = stationMask[i + 1] > 0.5 ? 0.0 : vlim[i + 1];

      vFwd[i + 1] = Math.min(Math.min(vNext, vTrackLim), vTrainLim);
    }

    // ---- Backward pass ----
    vBwd[n - 1] = 0.0;
    for (let i = n - 1; i > 0; i--) {
      const vCurr = vBwd[i];
      const Fb = maxBrakingEffort(vCurr, mass, adhMass, brakeV, brakeA);
      const Rroll = rollingResistance(mass, vCurr, da, db, dc);
      const Rslope = slopeResistance(mass, slope[i]);
      const Rcurve = curveResistance(mass, curve[i]);

      const Fnet = Fb + Rroll - Rslope + Rcurve;
      const a = Fnet / effectiveMass(mass, rotInertia);

      const ds = pos[i] - pos[i - 1];
      const vPrevSq = vCurr * vCurr + 2 * a * ds;
      const vPrev = vPrevSq > 0 ? Math.sqrt(vPrevSq) : 0.0;
      const vTrackLim = stationMask[i - 1] > 0.5 ? 0.0 : vlim[i - 1];

      vBwd[i - 1] = Math.min(Math.min(vPrev, vTrackLim), vTrainLim);
    }

    // ---- Merge & accumulate ----
    outTime[0] = 0.0;
    outEnergy[0] = 0.0;
    outV[0] = Math.min(vFwd[0], vBwd[0]);

    for (let i = 0; i < n - 1; i++) {
      const v1 = outV[i];
      const v2 = Math.min(vFwd[i + 1], vBwd[i + 1]);
      outV[i + 1] = v2;

      const vAvg = (v1 + v2) / 2.0;
      const ds = pos[i + 1] - pos[i];

      const dt = vAvg > 0 ? ds / vAvg : 0.0;
      outTime[i + 1] = outTime[i] + dt + dwell[i];

      const acc = ds > 0 ? (v2 * v2 - v1 * v1) / (2 * ds) : 0.0;
      const Rroll = rollingResistance(mass, vAvg, da, db, dc);
      const Rslope = slopeResistance(mass, slope[i]);
      const Rcurve = curveResistance(mass, curve[i]);

      const force = effectiveMass(mass, rotInertia) * acc + Rroll + Rslope + Rcurve;
      if (force >= 0) {
        outForce[i] = Math.min(force, maxTractiveEffort(vAvg, mass, adhMass, tracV, tracF));
        outEnergy[i + 1] = outEnergy[i] + outForce[i] * ds;
      } else {
        outForce[i] = Math.max(force, -maxBrakingEffort(vAvg, mass, adhMass, brakeV, brakeA));
        outEnergy[i + 1] = outEnergy[i];
      }
    }

    outTime[n - 1] += dwell[n - 1];
    outForce[n - 1] = 0.0;

    return {
      v: Array.from(outV),
      time: Array.from(outTime),
      energy: Array.from(outEnergy),
      force: Array.from(outForce)
    };
  }

  return { runSimulation };
})();
