// =============================================================
// D3.js CHART — Rendering engine (Marey / string-line diagram)
//
// Zoom model: SEMANTIC zoom on the TIME axis only. The vertical
// (distance/station) axis is fixed so station spacing and labels
// never distort. On zoom we rescale the X scale and redraw geometry
// rather than applying an SVG transform, which keeps strokes crisp
// and decouples time-zoom from distance.
// =============================================================
import { STATE, chartState, getPlan } from './state.js';
import { StateManager } from './state-manager.js';
import { DOM } from './dom.js';
import { escapeHtml, formatTimeHMS, formatTimeHM, formatDuration } from './utils.js';
import { shiftService, setStationDwell } from './schedule.js';
import { buildServiceCurve as buildCurve } from './curve.js';
import { updateDetailPanel } from './ui.js';

// ---- Helpers ----

/** Stable key for a service within a plan (used for D3 data-joins). */
function serviceKey(planId, svcIdx) {
  return `${planId}::${svcIdx}`;
}

/** Whether a given plan/service is the currently selected one. */
function isServiceSelected(planId, svcIdx) {
  return !!STATE.selectedService &&
    STATE.selectedService.planId === planId &&
    STATE.selectedService.serviceIndex === svcIdx;
}

/** Build a line generator bound to the current x (time) and y (distance) scales. */
function buildLineGen(rx, yScale) {
  return d3.line().x(p => rx(p[0])).y(p => yScale(p[1]));
}

/** Position the shared tooltip relative to the chart panel from a DOM event. */
function positionTooltip(tooltip, clientX, clientY) {
  const rect = DOM.get('chart-panel').getBoundingClientRect();
  tooltip.style.left = (clientX - rect.left + 14) + 'px';
  tooltip.style.top = (clientY - rect.top - 30) + 'px';
}

// ---- Chart Initialization ----
export function initChart(preserveTransform) {
  const panel = DOM.get('chart-panel');
  const svg = d3.select('#chart-svg');

  // Capture the current zoom transform so a resize doesn't reset the view.
  let prevTransform = null;
  if (preserveTransform && chartState.svg) {
    prevTransform = d3.zoomTransform(chartState.svg.node());
  }

  svg.selectAll('*').remove();

  const rect = panel.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  chartState.width = width;
  chartState.height = height;
  chartState.margin.left = Math.max(90, width * 0.12);

  const m = chartState.margin;
  const innerW = width - m.left - m.right;
  const innerH = height - m.top - m.bottom;

  svg.attr('width', width).attr('height', height);

  // Background
  svg.append('rect')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('fill', '#fafbfc');

  // Chart group (margin offset)
  const chartG = svg.append('g')
    .attr('transform', `translate(${m.left},${m.top})`);

  // Clip path covering the plot area
  chartG.append('defs').append('clipPath')
    .attr('id', 'chart-clip')
    .append('rect')
    .attr('x', 0).attr('y', 0)
    .attr('width', innerW).attr('height', innerH);

  // ---- Layers (back to front) ----
  // Horizontal station grid: fixed.
  const yGridG = chartG.append('g').attr('class', 'y-grid-layer');
  // Vertical time grid: redrawn on zoom.
  const xGridG = chartG.append('g')
    .attr('class', 'x-grid-layer')
    .attr('clip-path', 'url(#chart-clip)');
  // Data layer: hit areas, service paths, draggable nodes — redrawn on zoom.
  const drawG = chartG.append('g').attr('clip-path', 'url(#chart-clip)');
  // Axes (fixed): station labels on the left, time labels at the bottom.
  const yAxisG = chartG.append('g').attr('class', 'axis axis-y');
  const xAxisG = chartG.append('g').attr('class', 'axis axis-x')
    .attr('transform', `translate(0,${innerH})`);

  // Scales
  const xScale = d3.scaleLinear().range([0, innerW]);
  const yScale = d3.scaleLinear().range([innerH, 0]);

  // ---- Zoom behavior (semantic, time-axis only) ----
  const zoom = d3.zoom()
    .scaleExtent([0.3, 50])
    .on('zoom', (event) => {
      chartState.transform = event.transform;
      chartState.rx = event.transform.rescaleX(xScale);
      redrawTimeAxis(chartState.rx);
      renderXAxis(xAxisG, xGridG, chartState.rx, innerW, innerH);
    });

  svg.call(zoom)
    .on('dblclick.zoom', null);          // replace default dblclick-zoom...
  svg.on('dblclick', fitToView);         // ...with fit-to-view

  // Store references
  chartState.svg = svg;
  chartState.chartG = chartG;
  chartState.drawG = drawG;
  chartState.yGridG = yGridG;
  chartState.xGridG = xGridG;
  chartState.xAxisG = xAxisG;
  chartState.yAxisG = yAxisG;
  chartState.xScale = xScale;
  chartState.yScale = yScale;
  chartState.zoom = zoom;
  chartState.innerW = innerW;
  chartState.innerH = innerH;
  chartState.m = m;
  chartState.transform = d3.zoomIdentity;
  chartState.rx = xScale;

  // Re-apply the preserved transform (clamped by the new extent).
  if (prevTransform) {
    svg.call(zoom.transform, prevTransform);
  }
}

/** Reset the view to fit all data (identity zoom over the data extent). */
export function fitToView() {
  if (!chartState.svg || !chartState.zoom) return;
  chartState.svg.transition().duration(300)
    .call(chartState.zoom.transform, d3.zoomIdentity);
}

// =============================================================
// MAIN CHART UPDATE (orchestrator)
// =============================================================
export function updateChart() {
  if (!STATE.corridorView || !STATE.services[STATE.corridorView]) return;

  const corridorData = STATE.services[STATE.corridorView];
  const corridorNodes = corridorData.nodes;
  const corridorPositions = corridorData.positions;

  // Lazy init
  if (!chartState.svg) initChart();

  const { yGridG, yAxisG, xAxisG, xGridG, xScale, yScale, innerW, innerH } = chartState;

  // Cache corridor geometry for drag / zoom redraws.
  chartState.corridorNodes = corridorNodes;
  chartState.corridorPositions = corridorPositions;

  // Hide tooltip (may be stuck from removed elements)
  DOM.get('chart-tooltip').style.opacity = '0';

  const allVisibleServices = STATE.servicePlans
    .filter(p => p.visible)
    .flatMap(p => p.services);

  // ---- Y (distance) domain — always set, fixed ----
  setupYScaleDomain(corridorNodes, yScale, innerH);

  // ---- X (time) domain ----
  let tMin, tMax;
  if (allVisibleServices.length === 0) {
    tMin = STATE.timeFilterStart !== null ? STATE.timeFilterStart : 0;
    tMax = STATE.timeFilterEnd   !== null ? STATE.timeFilterEnd   : 1440;
  } else {
    const allTimes = allVisibleServices.flatMap(s => s.times.flatMap(t => [t.arr, t.dep]));
    tMin = Math.max(0, d3.min(allTimes) - 10);  // never show negative time
    tMax = d3.max(allTimes) + 10;
    if (STATE.timeFilterStart !== null) tMin = STATE.timeFilterStart;
    if (STATE.timeFilterEnd   !== null) tMax = STATE.timeFilterEnd;
  }
  if (tMax <= tMin) tMax = tMin + 60;
  setupXScaleDomain(xScale, innerW, tMin, tMax);

  // Current zoomed x-scale (preserves the live zoom transform).
  chartState.rx = (chartState.transform || d3.zoomIdentity).rescaleX(xScale);
  const rx = chartState.rx;

  // ---- Render layers ----
  updateYAxis(corridorNodes, corridorPositions, yScale, yAxisG, yGridG, innerW);
  renderBlocks(rx, yScale);
  renderServicePaths(corridorNodes, corridorPositions, rx, yScale);
  renderSelectedServiceNodes(corridorNodes, corridorPositions, rx, yScale);
  renderXAxis(xAxisG, xGridG, rx, innerW, innerH);

  updateLegend();
}

// =============================================================
// RENDER FUNCTIONS
// =============================================================

/** Set Y scale domain from corridor station km values. */
function setupYScaleDomain(corridorNodes, yScale, innerH) {
  const allKm = corridorNodes.map(n => n.km);
  const kmMin = d3.min(allKm);
  const kmMax = d3.max(allKm);
  const yPad = (kmMax - kmMin) * 0.05;
  yScale.domain([kmMax + yPad, kmMin - yPad]).range([0, innerH]);
}

/** Set X scale domain from time bounds (in minutes). */
function setupXScaleDomain(xScale, innerW, tMin, tMax) {
  xScale.domain([tMin, tMax]).range([0, innerW]);
}

/** Render X-axis labels and grid for the given (zoomed) time scale. */
function renderXAxis(xAxisG, xGridG, rx, innerW, innerH) {
  const k = (chartState.transform || d3.zoomIdentity).k;
  const tickCount = Math.max(2, Math.floor(innerW / (80 * k)));

  xAxisG.call(
    d3.axisBottom(rx)
      .tickFormat(d => formatTimeHM(d))
      .ticks(tickCount)
  );

  xGridG.call(
    d3.axisBottom(rx)
      .tickSize(-innerH)
      .tickSizeOuter(0)
      .tickFormat('')
      .ticks(tickCount)
  );
  xGridG.select('.domain').remove();
}

function updateYAxis(corridorNodes, corridorPositions, yScale, yAxisG, yGridG, innerW) {
  yAxisG.call(d3.axisLeft(yScale)
    .tickValues(corridorNodes.map(n => n.km))
    .tickFormat(d => {
      const node = corridorNodes.find(n => n.km === d);
      return node ? node.name : '';
    })
  );

  yGridG.selectAll('line')
    .data(corridorNodes)
    .join('line')
    .attr('x1', 0)
    .attr('x2', innerW)
    .attr('y1', d => yScale(d.km))
    .attr('y2', d => yScale(d.km))
    .attr('stroke', '#e2e8f0')
    .attr('stroke-width', 0.5)
    .attr('stroke-dasharray', '3 5');
}

/**
 * Build the [time, km] polyline for a service trip mapped into the CURRENT
 * corridor view. The string-line geometry (including the cross-corridor remap
 * via shared stations) lives in the pure `curve.js` module; this wrapper just
 * feeds it the relevant slices of STATE.
 */
function buildServiceCurve(svc) {
  const data = STATE.services[svc.serviceKey];
  const dirData = data && data.dir && data.dir[svc.direction];
  const onCorridor = svc.serviceKey === STATE.corridorView;
  const corridor = STATE.services[STATE.corridorView];
  const corridorPositions = corridor ? corridor.positions : {};
  return buildCurve(svc, dirData, onCorridor, corridorPositions);
}

/**
 * The km at which a trip's station should be plotted in the current
 * corridor, or undefined if the station isn't part of the corridor.
 */
function corridorKmFor(svc, stationEntry) {
  if (svc.serviceKey === STATE.corridorView) return stationEntry.km;
  const corridor = STATE.services[STATE.corridorView];
  return corridor ? corridor.positions[stationEntry.node] : undefined;
}

/**
 * Draw visible service polylines and invisible hit areas via D3 data-joins
 * (no clear-and-rebuild — elements are reused across renders).
 */
function renderServicePaths(corridorNodes, corridorPositions, rx, yScale) {
  const drawG = chartState.drawG;

  let hitareaLayer = drawG.select('g.hitarea-layer');
  if (hitareaLayer.empty()) hitareaLayer = drawG.append('g').attr('class', 'hitarea-layer');
  let plansLayer = drawG.select('g.service-layer');
  if (plansLayer.empty()) plansLayer = drawG.append('g').attr('class', 'service-layer');

  chartState.hitareaLayer = hitareaLayer;
  chartState.plansLayer = plansLayer;

  const lineGen = buildLineGen(rx, yScale);

  // Build the bound dataset (skip services with <2 curve points). The
  // corridor-mapped curve is computed ONCE here and cached on the datum as
  // `d.points`; the hit area, the visible path, and zoom redraws all reuse
  // it. It's only rebuilt when a trip's times change (see redrawService).
  const data = [];
  STATE.servicePlans.filter(p => p.visible).forEach(plan => {
    plan.services.forEach((svc, svcIdx) => {
      const points = buildServiceCurve(svc);
      if (points.length < 2) return;
      data.push({
        key: serviceKey(plan.id, svcIdx),
        plan, svc, svcIdx,
        planId: plan.id,
        points,
        selected: isServiceSelected(plan.id, svcIdx)
      });
    });
  });

  // Invisible wide hit areas (easier clicking / line dragging).
  hitareaLayer.selectAll('path.service-hitarea')
    .data(data, d => d.key)
    .join(
      enter => enter.append('path').attr('class', 'service-hitarea'),
      update => update,
      exit => exit.remove()
    )
    .attr('d', d => lineGen(d.points))
    .each(function(d) { attachServiceInteractions(d3.select(this), d); });

  // Visible service paths.
  plansLayer.selectAll('path.service-path')
    .data(data, d => d.key)
    .join(
      enter => enter.append('path').attr('class', 'service-path'),
      update => update,
      exit => exit.remove()
    )
    .attr('d', d => lineGen(d.points))
    .attr('stroke', d => d.plan.color)
    .attr('data-plan-id', d => d.planId)
    .attr('data-svc-idx', d => d.svcIdx)
    .classed('selected', d => d.selected)
    .each(function(d) { attachServiceInteractions(d3.select(this), d); });
}

/**
 * Signaling-block occupancy rectangles for one service curve.
 *
 * The corridor distance axis is partitioned into fixed blocks of length `Lkm`
 * measured from distance 0 (a shared grid for every train/direction). For each
 * block the curve passes through we emit one rectangle whose height is the
 * block's distance band and whose time-extent [t0,t1] is how long the train is
 * within that band — i.e. block_length / speed, so faster trains get narrower
 * rectangles. The curve runs corner-to-corner through each rectangle, so the
 * stack is a staircase "buffer" that hugs the service line.
 *
 * @param {Array<[number,number]>} points — [time(min), distance(km)] polyline.
 * @param {number} Lkm — block length in km (> 0).
 */
function computeBlockRects(points, Lkm) {
  if (!points || points.length < 2 || !(Lkm > 0)) return [];

  let minKm = Infinity, maxKm = -Infinity;
  for (const p of points) {
    if (p[1] < minKm) minKm = p[1];
    if (p[1] > maxKm) maxKm = p[1];
  }
  const bFirst = Math.floor(minKm / Lkm);
  const bLast = Math.ceil(maxKm / Lkm) - 1;

  const rects = [];
  for (let b = bFirst; b <= bLast; b++) {
    const lo = b * Lkm, hi = (b + 1) * Lkm;
    // Clip each polyline segment to the band [lo,hi] and take the union of the
    // time spans. Time advances monotonically along `points`, so the min entry
    // / max exit time bound the (contiguous) occupancy of this band.
    let t0 = Infinity, t1 = -Infinity;
    for (let i = 0; i < points.length - 1; i++) {
      const [ta, da] = points[i];
      const [tb, db] = points[i + 1];
      let s0, s1;
      if (da === db) {
        if (da < lo || da > hi) continue;   // dwell outside this band
        s0 = 0; s1 = 1;
      } else {
        const sLo = (lo - da) / (db - da);
        const sHi = (hi - da) / (db - da);
        s0 = Math.max(0, Math.min(sLo, sHi));
        s1 = Math.min(1, Math.max(sLo, sHi));
        if (s1 <= s0) continue;             // segment misses this band
      }
      const tStart = ta + (tb - ta) * s0;
      const tEnd = ta + (tb - ta) * s1;
      if (tStart < t0) t0 = tStart;
      if (tEnd > t1) t1 = tEnd;
    }
    if (t1 > t0) rects.push({ b, lo, hi, t0, t1 });
  }
  return rects;
}

// Blocks narrower than this many on-screen pixels are culled — at that size
// they're invisible anyway, and skipping them keeps the DOM light when zoomed
// out (an all-day view can hold thousands of blocks). The cull is width-based,
// so it re-evaluates on every zoom level via drawBlockRects.
const MIN_BLOCK_PX = 0.6;

/**
 * Draw the signaling-block overlay (one translucent rectangle per block each
 * visible service occupies). Rendered into a layer beneath the service lines.
 * Controlled by STATE.showBlocks / STATE.blockLengthM.
 *
 * The full block geometry is computed once here and cached on
 * chartState.blockData; the actual DOM join (with sub-pixel culling) lives in
 * drawBlockRects so zoom redraws can re-cull cheaply without recomputing it.
 */
function renderBlocks(rx, yScale) {
  const drawG = chartState.drawG;
  let blockLayer = drawG.select('g.block-layer');
  if (blockLayer.empty()) {
    // Insert beneath the hitarea/service/node layers so lines stay on top.
    blockLayer = drawG.insert('g', ':first-child').attr('class', 'block-layer');
  }
  chartState.blockLayer = blockLayer;

  const Lkm = (STATE.blockLengthM || 0) / 1000;
  const blockData = [];
  if (STATE.showBlocks && Lkm > 0) {
    STATE.servicePlans.filter(p => p.visible).forEach(plan => {
      plan.services.forEach((svc, svcIdx) => {
        const points = buildServiceCurve(svc);
        if (points.length < 2) return;
        const base = serviceKey(plan.id, svcIdx);
        computeBlockRects(points, Lkm).forEach(r => blockData.push({
          key: base + ':' + r.b,
          color: plan.color,
          t0: r.t0, t1: r.t1, lo: r.lo, hi: r.hi
        }));
      });
    });
  }
  chartState.blockData = blockData;
  drawBlockRects(rx, yScale);
}

/**
 * Bind the cached block dataset to the layer, culling rects whose current
 * on-screen width is below MIN_BLOCK_PX. Called on full render and on every
 * zoom redraw (where the pixel width — and thus the cull set — changes).
 */
function drawBlockRects(rx, yScale) {
  const layer = chartState.blockLayer;
  if (!layer) return;
  const data = (chartState.blockData || [])
    .filter(d => rx(d.t1) - rx(d.t0) >= MIN_BLOCK_PX);

  layer.selectAll('rect.block-rect')
    .data(data, d => d.key)
    .join(
      enter => enter.append('rect').attr('class', 'block-rect'),
      update => update,
      exit => exit.remove()
    )
    .attr('x', d => rx(d.t0))
    .attr('width', d => Math.max(0, rx(d.t1) - rx(d.t0)))
    .attr('y', d => yScale(d.hi))
    .attr('height', d => Math.max(0, yScale(d.lo) - yScale(d.hi)))
    .attr('fill', d => d.color)
    .attr('stroke', d => d.color);
}

/**
 * Wire up click-to-select on any service line, and whole-trip dragging on the
 * selected line. (Hover styling is handled in CSS.)
 */
function attachServiceInteractions(sel, d) {
  sel
    .classed('selected', d.selected)
    .on('click', (event) => { event.stopPropagation(); selectService(d.planId, d.svcIdx); });

  if (d.selected) {
    sel.call(serviceShiftDrag(d));
  } else {
    sel.on('.drag', null);  // unselected lines: no drag, let pan through
  }
}

/** Drag behavior that shifts an entire service in time by grabbing its line. */
function serviceShiftDrag(d) {
  const { plan, svc, svcIdx } = d;
  // Per-drag transient state, scoped to this behavior instance.
  let ld = null;
  return d3.drag()
    .on('start', function(event) {
      ld = {
        started: false,
        startTime: chartState.rx.invert(event.x),
        orig: svc.times.map(t => ({ arr: t.arr, dep: t.dep })),
        minArr: d3.min(svc.times, t => t.arr)
      };
    })
    .on('drag', function(event) {
      if (!ld) return;
      if (!ld.started) {
        StateManager.beginTimeEdit();   // snapshot once, on first movement
        ld.started = true;
      }
      let delta = chartState.rx.invert(event.x) - ld.startTime;
      if (ld.minArr + delta < 0) delta = -ld.minArr;  // clamp at midnight

      svc.times.forEach((t, i) => {
        t.arr = ld.orig[i].arr + delta;
        t.dep = ld.orig[i].dep + delta;
      });
      redrawService(plan.id, svcIdx, svc);

      const tooltip = DOM.get('chart-tooltip');
      const sign = delta >= 0 ? '+' : '−';
      tooltip.innerHTML = `<b>${escapeHtml(plan.name || plan.serviceKey)} #${svc.serviceId}</b> shift ${sign}${formatDuration(Math.abs(delta))}`;
      tooltip.style.opacity = '1';
      positionTooltip(tooltip, event.sourceEvent.clientX, event.sourceEvent.clientY);
    })
    .on('end', function() {
      DOM.get('chart-tooltip').style.opacity = '0';
      if (ld && ld.started) {
        updateDetailPanel();
        StateManager.endTimeEdit();
      }
      ld = null;
    });
}

/** Draw the draggable time-edit nodes for the currently selected service. */
function renderSelectedServiceNodes(corridorNodes, corridorPositions, rx, yScale) {
  const drawG = chartState.drawG;
  let nodesLayer = drawG.select('g.node-layer');
  if (nodesLayer.empty()) nodesLayer = drawG.append('g').attr('class', 'node-layer');
  nodesLayer.raise();
  chartState.nodesLayer = nodesLayer;

  if (!STATE.selectedService) {
    nodesLayer.selectAll('circle').remove();
    chartState.selDrag = null;
    return;
  }

  const sel = STATE.selectedService;
  const plan = getPlan(sel.planId);
  const svc = plan && plan.services[sel.serviceIndex];
  if (!plan || !svc) {
    nodesLayer.selectAll('circle').remove();
    chartState.selDrag = null;
    return;
  }

  chartState.selDrag = { plan, svc, svcIdx: sel.serviceIndex };
  renderDraggableNodes(nodesLayer, plan, svc, sel.serviceIndex, corridorPositions, rx, yScale);
}

/** Render and wire the draggable circles for a selected service. */
function renderDraggableNodes(nodesLayer, plan, svc, svcIdx, corridorPositions, rx, yScale) {
  const pointMeta = [];
  svc.times.forEach((t, idx) => {
    const km = corridorKmFor(svc, t); // align with the corridor-mapped curve
    if (km === undefined) return;     // station not in the current corridor
    pointMeta.push({ km, node: t.node, stationIdx: idx, isArrival: true });
    // Departure node only adds value when there's a dwell to grab; for
    // pass-through stations arr === dep, so one node suffices.
    if (t.dep > t.arr) {
      pointMeta.push({ km, node: t.node, stationIdx: idx, isArrival: false });
    }
  });

  const nodeTime = d => {
    const entry = svc.times[d.stationIdx];
    return d.isArrival ? entry.arr : entry.dep;
  };

  // Per-drag transient flag, scoped to this render's drag behavior instance.
  let editStarted = false;

  nodesLayer.selectAll('circle')
    .data(pointMeta)
    .join('circle')
    .attr('class', 'node-dot')
    .attr('r', 5)
    .attr('cx', d => rx(nodeTime(d)))
    .attr('cy', d => yScale(d.km))
    .attr('fill', plan.color)
    // Keep a node click from bubbling to the chart-panel handler, which would
    // otherwise deselect the very service whose nodes you're trying to edit.
    .on('click', event => event.stopPropagation())
    .on('mouseover', function(event, d) {
      const tooltip = DOM.get('chart-tooltip');
      tooltip.innerHTML = `<b>${escapeHtml(d.node)}</b> ${d.isArrival ? 'Arr' : 'Dep'}: ${formatTimeHMS(nodeTime(d))}`;
      tooltip.style.opacity = '1';
      positionTooltip(tooltip, event.clientX, event.clientY);
    })
    .on('mousemove', function(event) {
      positionTooltip(DOM.get('chart-tooltip'), event.clientX, event.clientY);
    })
    .on('mouseout', () => { DOM.get('chart-tooltip').style.opacity = '0'; })
    .call(d3.drag()
      .on('start', function() {
        editStarted = false;
        d3.select(this).raise();
      })
      .on('drag', function(event, d) {
        if (!editStarted) {
          StateManager.beginTimeEdit();   // snapshot once, on first movement
          editStarted = true;
        }
        const newTime = chartState.rx.invert(event.x);
        const entry = svc.times[d.stationIdx];
        // Running times are fixed by physics: an arrival drag shifts the
        // whole trip; a departure drag adjusts the dwell at this stop.
        if (d.isArrival || !entry.stop) {
          shiftService(svc, newTime - entry.arr);
        } else {
          setStationDwell(svc, d.stationIdx, newTime - entry.arr);
        }

        redrawService(plan.id, svcIdx, svc);

        const tooltip = DOM.get('chart-tooltip');
        const newVal = d.isArrival ? entry.arr : entry.dep;
        const label = d.isArrival ? 'Arr' : (entry.stop ? 'Dep (dwell)' : 'Dep');
        tooltip.innerHTML = `<b>${escapeHtml(d.node)}</b> ${label}: ${formatTimeHMS(newVal)}`;
        positionTooltip(tooltip, event.sourceEvent.clientX, event.sourceEvent.clientY);
      })
      .on('end', function() {
        if (editStarted) {
          updateDetailPanel();
          StateManager.endTimeEdit();
        }
        editStarted = false;
      })
    );
}

/**
 * Redraw a single service's path, hit area, and (if selected) its nodes from the
 * current data model and zoom scale — used for smooth live updates during drag.
 */
function redrawService(planId, svcIdx, svc) {
  const rx = chartState.rx;
  const yScale = chartState.yScale;
  const lineGen = buildLineGen(rx, yScale);
  const pts = buildServiceCurve(svc);
  const key = serviceKey(planId, svcIdx);

  // The trip's times changed, so refresh the cached curve on the bound datum
  // (keeps zoom redraws using d.points correct without a full re-render).
  const updatePoints = d => { if (d.key === key) d.points = pts; };

  chartState.plansLayer.selectAll('path.service-path')
    .filter(d => d.key === key).each(updatePoints).attr('d', lineGen(pts));
  chartState.hitareaLayer.selectAll('path.service-hitarea')
    .filter(d => d.key === key).each(updatePoints).attr('d', lineGen(pts));

  if (chartState.nodesLayer) {
    chartState.nodesLayer.selectAll('circle')
      .attr('cx', d => rx(d.isArrival ? svc.times[d.stationIdx].arr : svc.times[d.stationIdx].dep))
      .attr('cy', d => yScale(d.km));
  }
}

/** Redraw all geometry against a new (zoomed) time scale. */
function redrawTimeAxis(rx) {
  const yScale = chartState.yScale;
  const lineGen = buildLineGen(rx, yScale);

  // Block rectangles only shift/scale in time (their distance bands are fixed).
  // Re-run the bind so the sub-pixel cull set updates for the new zoom level.
  if (chartState.blockLayer) {
    drawBlockRects(rx, yScale);
  }

  // Zoom only rescales time — the [time, km] curve is unchanged, so reuse
  // the cached d.points rather than rebuilding it for every service.
  if (chartState.plansLayer) {
    chartState.plansLayer.selectAll('path.service-path')
      .attr('d', d => lineGen(d.points || buildServiceCurve(d.svc)));
  }
  if (chartState.hitareaLayer) {
    chartState.hitareaLayer.selectAll('path.service-hitarea')
      .attr('d', d => lineGen(d.points || buildServiceCurve(d.svc)));
  }
  if (chartState.nodesLayer && chartState.selDrag) {
    const svc = chartState.selDrag.svc;
    chartState.nodesLayer.selectAll('circle')
      .attr('cx', d => rx(d.isArrival ? svc.times[d.stationIdx].arr : svc.times[d.stationIdx].dep))
      .attr('cy', d => yScale(d.km));
  }
}

// =============================================================
// SELECTION & LEGEND
// =============================================================

function selectService(planId, serviceIndex) {
  StateManager.selectService(planId, serviceIndex);
}

function updateLegend() {
  const legend = DOM.get('chart-legend');
  const visiblePlans = STATE.servicePlans.filter(p => p.visible);
  if (visiblePlans.length === 0) {
    legend.style.display = 'none';
    return;
  }
  legend.style.display = '';
  legend.replaceChildren(...visiblePlans.map(p =>
    DOM.el('div', { className: 'legend-item' },
      DOM.el('div', { className: 'legend-swatch', style: { background: p.color } }),
      DOM.el('span', {}, `${p.name || p.serviceKey} (${p.headwayMin}')`)
    )
  ));
}
