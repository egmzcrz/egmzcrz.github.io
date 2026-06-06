// =============================================================
// D3.js CHART — Rendering engine (Marey / string-line diagram)
//
// Zoom model: SEMANTIC zoom on the TIME axis only. The vertical
// (distance/station) axis is fixed so station spacing and labels
// never distort. On zoom we rescale the X scale and redraw geometry
// rather than applying an SVG transform, which keeps strokes crisp
// and decouples time-zoom from distance.
// =============================================================

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

/** Format a duration in minutes as "Mm SSs" (used in the shift tooltip). */
function formatDuration(min) {
  const totalSec = Math.round(min * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/** Format minutes-from-midnight as HH:MM for axis ticks (hours may exceed 23). */
function formatAxisTime(minutes) {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const mm = ((m % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Position the shared tooltip relative to the chart panel from a DOM event. */
function positionTooltip(tooltip, clientX, clientY) {
  const rect = DOM.get('chart-panel').getBoundingClientRect();
  tooltip.style.left = (clientX - rect.left + 14) + 'px';
  tooltip.style.top = (clientY - rect.top - 30) + 'px';
}

// ---- Chart Initialization ----
function initChart(preserveTransform) {
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
  // Single-track bands: span full width, vertical only — fixed across zoom.
  const stLayer = chartG.append('g')
    .attr('class', 'single-track-layer')
    .attr('clip-path', 'url(#chart-clip)');
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
  chartState.stLayer = stLayer;
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
function fitToView() {
  if (!chartState.svg || !chartState.zoom) return;
  chartState.svg.transition().duration(300)
    .call(chartState.zoom.transform, d3.zoomIdentity);
}

// =============================================================
// MAIN CHART UPDATE (orchestrator)
// =============================================================
function updateChart() {
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
  renderSingleTrackLayer(corridorData.singleTrackSegments, yScale, innerW);
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
      .tickFormat(d => formatAxisTime(d))
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

/** Draw single-track segments as full-width red dashed bands (fixed across zoom). */
function renderSingleTrackLayer(stSegs, yScale, innerW) {
  const segs = stSegs || [];
  chartState.stLayer.selectAll('rect')
    .data(segs)
    .join('rect')
    .attr('x', 0)
    .attr('width', innerW)
    .attr('y', d => Math.min(yScale(d.fromKm), yScale(d.toKm)))
    .attr('height', d => Math.max(Math.abs(yScale(d.toKm) - yScale(d.fromKm)), 1))
    .attr('fill', 'rgba(239, 68, 68, 0.10)')
    .attr('stroke', 'rgba(239, 68, 68, 0.22)')
    .attr('stroke-width', 0.5)
    .attr('stroke-dasharray', '6 4');
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

/** Build polyline points for a service — only at stations on this corridor. */
function buildServicePoints(svc, corridorNodes, corridorPositions) {
  const points = [];
  svc.times.forEach(t => {
    const km = corridorPositions[t.node];
    if (km === undefined) return; // station not in this corridor — skip
    points.push([t.arr, km]);
    points.push([t.dep, km]);
  });
  return points;
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

  // Build the bound dataset (skip services with <2 corridor points).
  const data = [];
  STATE.servicePlans.filter(p => p.visible).forEach(plan => {
    plan.services.forEach((svc, svcIdx) => {
      const points = buildServicePoints(svc, corridorNodes, corridorPositions);
      if (points.length < 2) return;
      data.push({
        key: serviceKey(plan.id, svcIdx),
        plan, svc, svcIdx,
        planId: plan.id,
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
    .attr('d', d => lineGen(buildServicePoints(d.svc, corridorNodes, corridorPositions)))
    .each(function(d) { attachServiceInteractions(d3.select(this), d); });

  // Visible service paths.
  plansLayer.selectAll('path.service-path')
    .data(data, d => d.key)
    .join(
      enter => enter.append('path').attr('class', 'service-path'),
      update => update,
      exit => exit.remove()
    )
    .attr('d', d => lineGen(buildServicePoints(d.svc, corridorNodes, corridorPositions)))
    .attr('stroke', d => d.plan.color)
    .attr('data-plan-id', d => d.planId)
    .attr('data-svc-idx', d => d.svcIdx)
    .classed('selected', d => d.selected)
    .each(function(d) { attachServiceInteractions(d3.select(this), d); });
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
  return d3.drag()
    .on('start', function(event) {
      chartState._lineDrag = {
        started: false,
        startTime: chartState.rx.invert(event.x),
        orig: svc.times.map(t => ({ arr: t.arr, dep: t.dep })),
        minArr: d3.min(svc.times, t => t.arr)
      };
    })
    .on('drag', function(event) {
      const ld = chartState._lineDrag;
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
      tooltip.innerHTML = `<b>${plan.serviceKey} #${svc.serviceId}</b> shift ${sign}${formatDuration(Math.abs(delta))}`;
      tooltip.style.opacity = '1';
      positionTooltip(tooltip, event.sourceEvent.clientX, event.sourceEvent.clientY);
    })
    .on('end', function() {
      const ld = chartState._lineDrag;
      chartState._lineDrag = null;
      DOM.get('chart-tooltip').style.opacity = '0';
      if (ld && ld.started) {
        updateDetailPanel();
        StateManager.endTimeEdit();
      }
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
  const plan = STATE.servicePlans.find(p => p.id === sel.planId);
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
    const km = corridorPositions[t.node];
    if (km === undefined) return;
    pointMeta.push({ km, node: t.node, stationIdx: idx, isArrival: true });
    pointMeta.push({ km, node: t.node, stationIdx: idx, isArrival: false });
  });

  const nodeTime = d => {
    const entry = svc.times[d.stationIdx];
    return d.isArrival ? entry.arr : entry.dep;
  };

  nodesLayer.selectAll('circle')
    .data(pointMeta)
    .join('circle')
    .attr('class', 'node-dot')
    .attr('r', 5)
    .attr('cx', d => rx(nodeTime(d)))
    .attr('cy', d => yScale(d.km))
    .attr('fill', plan.color)
    .on('mouseover', function(event, d) {
      const tooltip = DOM.get('chart-tooltip');
      tooltip.innerHTML = `<b>${d.node}</b> ${d.isArrival ? 'Arr' : 'Dep'}: ${formatTimeHHMM(nodeTime(d))}`;
      tooltip.style.opacity = '1';
      positionTooltip(tooltip, event.clientX, event.clientY);
    })
    .on('mousemove', function(event) {
      positionTooltip(DOM.get('chart-tooltip'), event.clientX, event.clientY);
    })
    .on('mouseout', () => { DOM.get('chart-tooltip').style.opacity = '0'; })
    .call(d3.drag()
      .on('start', function() {
        chartState._nodeEditStarted = false;
        d3.select(this).raise();
      })
      .on('drag', function(event, d) {
        if (!chartState._nodeEditStarted) {
          StateManager.beginTimeEdit();   // snapshot once, on first movement
          chartState._nodeEditStarted = true;
        }
        const rxNow = chartState.rx;
        const newTime = rxNow.invert(event.x);
        const constrained = constrainTime(svc, d.stationIdx, d.isArrival, newTime, plan.serviceKey);
        const oldVal = d.isArrival ? svc.times[d.stationIdx].arr : svc.times[d.stationIdx].dep;
        propagateTimeDelta(svc, d.stationIdx, d.isArrival, constrained - oldVal);

        redrawService(plan.id, svcIdx, svc);

        const tooltip = DOM.get('chart-tooltip');
        const newVal = d.isArrival ? svc.times[d.stationIdx].arr : svc.times[d.stationIdx].dep;
        tooltip.innerHTML = `<b>${d.node}</b> ${d.isArrival ? 'Arr' : 'Dep'}: ${formatTimeHHMM(newVal)}`;
        positionTooltip(tooltip, event.sourceEvent.clientX, event.sourceEvent.clientY);
      })
      .on('end', function() {
        if (chartState._nodeEditStarted) {
          enforceConstraints(svc, plan.serviceKey);
          updateDetailPanel();
          StateManager.endTimeEdit();
        }
        chartState._nodeEditStarted = false;
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
  const pts = buildServicePoints(svc, chartState.corridorNodes, chartState.corridorPositions);
  const key = serviceKey(planId, svcIdx);

  chartState.plansLayer.selectAll('path.service-path')
    .filter(d => d.key === key).attr('d', lineGen(pts));
  chartState.hitareaLayer.selectAll('path.service-hitarea')
    .filter(d => d.key === key).attr('d', lineGen(pts));

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
  const nodes = chartState.corridorNodes;
  const positions = chartState.corridorPositions;

  if (chartState.plansLayer) {
    chartState.plansLayer.selectAll('path.service-path')
      .attr('d', d => lineGen(buildServicePoints(d.svc, nodes, positions)));
  }
  if (chartState.hitareaLayer) {
    chartState.hitareaLayer.selectAll('path.service-hitarea')
      .attr('d', d => lineGen(buildServicePoints(d.svc, nodes, positions)));
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
  legend.innerHTML = visiblePlans.map(p => `
<div class="legend-item">
<div class="legend-swatch" style="background:${p.color};"></div>
<span>${p.serviceKey} (${p.headwayMin}')</span>
</div>
`).join('');
}
