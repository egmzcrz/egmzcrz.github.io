// =============================================================
// SCHEDULE MODEL — Time math & constraint enforcement
// =============================================================

/**
 * Build arrival/departure times for a single trip along a sequence of stations.
 *
 * @param {Array<{name: string, km: number, dwell_min: number}>} nodes
 *   Ordered list of stations with their dwell times.
 * @param {number} startTimeMin — Departure time from the first station (minutes from midnight).
 * @param {Object<string, number>} baseRunningTime
 *   Map of "StationA→StationB" keys to minimum running times in minutes.
 * @returns {Array<{node: string, arr: number, dep: number}>}
 *   Array of {node, arrival, departure} for each station in order.
 */
function buildTripTimesForService(nodes, startTimeMin, baseRunningTime) {
  const times = [];
  let currentTime = startTimeMin;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const arr = currentTime;
    const dep = arr + node.dwell_min;
    times.push({ node: node.name, arr, dep });

    currentTime = dep;
    if (i < nodes.length - 1) {
      const nextNode = nodes[i + 1];
      const key = `${node.name}→${nextNode.name}`;
      // Try both directions for running time
      const rt = baseRunningTime[key] || baseRunningTime[`${nextNode.name}→${node.name}`] || 1;
      currentTime += rt;
    }
  }

  return times;
}

/**
 * Constrain a time edit to respect minimum running times and dwell times.
 *
 * @param {Object} svc — Service object with a `times` array of {node, arr, dep}.
 * @param {number} stationIdx — Index into `svc.times`.
 * @param {boolean} isArrival — True if editing arrival, false if editing departure.
 * @param {number} newTimeMin — Proposed new time in minutes from midnight.
 * @param {string} serviceKey — Key into STATE.services for constraint data.
 * @returns {number} The constrained time (never less than minimum allowed).
 */
function constrainTime(svc, stationIdx, isArrival, newTimeMin, serviceKey) {
  const data = STATE.services[serviceKey];
  if (!data) return newTimeMin;

  const baseRT = data.baseRunningTime;
  const baseDwell = data.baseDwellTime || {};
  const times = svc.times;

  // Minimum arrival time at station 0: 0
  if (stationIdx === 0 && isArrival) {
    return Math.max(0, newTimeMin);
  }

  // --- Running time from previous station ---
  // arrival[stationIdx] - departure[stationIdx-1] >= baseRT
  if (isArrival && stationIdx > 0) {
    const prevDep = times[stationIdx - 1].dep;
    const prevNode = times[stationIdx - 1].node;
    const thisNode = times[stationIdx].node;
    const key1 = `${prevNode}→${thisNode}`;
    const key2 = `${thisNode}→${prevNode}`;
    const minRT = baseRT[key1] || baseRT[key2] || 0.1;
    newTimeMin = Math.max(newTimeMin, prevDep + minRT);
  }

  // --- Dwell time constraint ---
  // departure - arrival >= baseDwellTime[station]
  const nodeName = times[stationIdx].node;
  const minDwell = baseDwell[nodeName] || 0;

  if (!isArrival) {
    // Dragging departure: must be >= arrival + minDwell
    newTimeMin = Math.max(newTimeMin, times[stationIdx].arr + minDwell);
  }

  return newTimeMin;
}

/**
 * Apply a time delta to a service node, forward-propagating to all later stations.
 * Does NOT push undo — callers should use StateManager.beginTimeEdit/endTimeEdit.
 *
 * @param {Object} svc — Service with `times` array.
 * @param {number} stationIdx — Index of the edited station.
 * @param {boolean} isArrival — True if the arrival was edited.
 * @param {number} newTime — New time value in minutes.
 * @param {string} serviceKey — Key into STATE.services.
 */
function applyTimeDelta(svc, stationIdx, isArrival, newTime, serviceKey) {
  const oldVal = isArrival ? svc.times[stationIdx].arr : svc.times[stationIdx].dep;
  const delta = newTime - oldVal;
  if (Math.abs(delta) < 0.0001) return;

  // Forward propagate: this node's departure onward shifts by delta
  for (let i = stationIdx; i < svc.times.length; i++) {
    if (i === stationIdx && isArrival) {
      svc.times[i].arr += delta;
    }
    svc.times[i].dep += delta;
    if (i + 1 < svc.times.length) {
      svc.times[i + 1].arr += delta;
    }
  }

  enforceConstraints(svc, serviceKey);
}

/**
 * Enforce minimum running times and dwell times across an entire service.
 * Modifies `svc.times` in place to satisfy all constraints.
 *
 * @param {Object} svc — Service with `times` array of {node, arr, dep}.
 * @param {string} serviceKey — Key into STATE.services for base constraint data.
 */
function enforceConstraints(svc, serviceKey) {
  const data = STATE.services[serviceKey];
  if (!data) return;

  const baseRT = data.baseRunningTime;
  const baseDwell = data.baseDwellTime || {};
  const times = svc.times;

  // Enforce running times
  for (let i = 0; i < times.length - 1; i++) {
    const rt = times[i + 1].arr - times[i].dep;
    const nodeA = times[i].node;
    const nodeB = times[i + 1].node;
    const minRT = baseRT[`${nodeA}→${nodeB}`] || baseRT[`${nodeB}→${nodeA}`] || 0;
    if (rt < minRT) {
      const deficit = minRT - rt;
      for (let j = i + 1; j < times.length; j++) {
        times[j].arr += deficit;
        times[j].dep += deficit;
      }
    }
  }

  // Enforce minimum dwell times
  for (let i = 0; i < times.length; i++) {
    const dwell = times[i].dep - times[i].arr;
    const nodeName = times[i].node;
    const minDwell = baseDwell[nodeName] || 0;
    if (dwell < minDwell) {
      times[i].dep = times[i].arr + minDwell;
    }
  }
}
