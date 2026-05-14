// =============================================================
// D3.js CHART — Rendering engine
// =============================================================

// ---- Chart Initialization ----
function initChart() {
  const panel = DOM.get('chart-panel');
  const svg = d3.select('#chart-svg');

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

  // Background rect
  svg.append('rect')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('fill', '#fafbfc');

  // ---- Fixed chart group (margin offset only) ----
  const chartG = svg.append('g')
  .attr('transform', `translate(${m.left},${m.top})`);

  // ---- Clip path (defined on chartG, covers the plot area) ----
  chartG.append('defs').append('clipPath')
    .attr('id', 'chart-clip')
    .append('rect')
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', innerW)
    .attr('height', innerH);

  // ---- Zoomable group (contains everything that pans/zooms) ----
  const zoomG = chartG.append('g').attr('class', 'zoom-group');

  // Y-axis grid lines (drawn first = behind data)
  const yGridG = zoomG.append('g').attr('class', 'y-grid-layer');

  // Data layer (clipped, drawn on top of grid)
  const drawG = zoomG.append('g')
  .attr('clip-path', 'url(#chart-clip)');

  // Y-axis (inside zoomG to pan vertically with the data)
  const yAxisG = zoomG.append('g').attr('class', 'axis axis-y');

  // ---- Fixed layers (outside zoomG, always visible) ----
  // X-axis grid lines (fixed, outside zoomG — but clipped to plot area)
  const xGridG = chartG.append('g')
  .attr('class', 'x-grid-layer')
  .attr('clip-path', 'url(#chart-clip)');

  // X-axis (fixed at bottom)
  const xAxisG = chartG.append('g').attr('class', 'axis axis-x')
  .attr('transform', `translate(0,${innerH})`);

  // Scales
  const xScale = d3.scaleLinear().range([0, innerW]);
  const yScale = d3.scaleLinear().range([innerH, 0]);

  // ---- Zoom behavior ----
  const zoom = d3.zoom()
  .scaleExtent([0.3, 25])
  .extent([[0, 0], [innerW, innerH]])
  .on('zoom', (event) => {
    const t = event.transform;
    const k = t.k;
    const ik = 1 / k;  // inverse scale

    // Transform the zoomable group (data + Y axis + Y grid all move together)
    zoomG.attr('transform', t);

    // Scale stroke-widths and node radii inversely so they stay sharp
    zoomG.selectAll('.service-path').style('stroke-width', (1.8 * ik) + 'px');
    zoomG.selectAll('.service-path.selected').style('stroke-width', (3.2 * ik) + 'px');
    zoomG.selectAll('.service-hitarea').style('stroke-width', (14 * ik) + 'px');
    zoomG.selectAll('.node-dot')
      .attr('r', 5 * ik)
      .style('stroke-width', (1.5 * ik) + 'px');

    // Redraw X-axis with rescaled domain (shared renderer)
    renderXAxis(xAxisG, xGridG, xScale, innerW, innerH);
  });

  svg.call(zoom);

  // Store references
  chartState.svg = svg;
  chartState.chartG = chartG;
  chartState.zoomG = zoomG;
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

  const { drawG, yGridG, xGridG, xAxisG, yAxisG, xScale, yScale, innerW, innerH } = chartState;

  // Hide tooltip (may be stuck from removed elements)
  DOM.get('chart-tooltip').style.opacity = '0';

  // Clear previous draws
  clearChartLayers(drawG, yGridG);

  // Compute visible services
  const allVisibleServices = STATE.servicePlans
    .filter(p => p.visible)
    .flatMap(p => p.services);

  // ---- Empty state: no services yet ----
  if (allVisibleServices.length === 0) {
    renderEmptyChart(corridorNodes, corridorPositions,
      yScale, yAxisG, yGridG, xScale, xAxisG, xGridG, innerW, innerH);
    updateLegend();
    return;
  }

  // ---- Compute time range ----
  const allTimes = allVisibleServices.flatMap(s => s.times.flatMap(t => [t.arr, t.dep]));
  let tMin = d3.min(allTimes) - 10;
  let tMax = d3.max(allTimes) + 10;
  if (STATE.timeFilterStart !== null) tMin = STATE.timeFilterStart;
  if (STATE.timeFilterEnd   !== null) tMax = STATE.timeFilterEnd;
  if (tMax <= tMin) tMax = tMin + 60;

  // ---- Set scales ----
  setupXScaleDomain(xScale, innerW, tMin, tMax);
  setupYScaleDomain(corridorNodes, yScale, innerH);

  // ---- Render layers (back to front) ----
  renderSingleTrackLayer(drawG, corridorData.singleTrackSegments, xScale, yScale, tMin, tMax);
  updateYAxis(corridorNodes, corridorPositions, yScale, yAxisG, yGridG, innerW);
  renderServicePaths(drawG, corridorNodes, corridorPositions, xScale, yScale);
  renderSelectedServiceNodes(drawG, corridorNodes, corridorPositions, xScale, yScale);
  renderXAxis(xAxisG, xGridG, xScale, innerW, innerH);

  // ---- Finalize ----
  updateLegend();
  highlightSelectedService();
  applyZoomScale();
}

// =============================================================
// EXTRACTED RENDER FUNCTIONS
// =============================================================

/** Clear all data-dependent SVG layers. */
function clearChartLayers(drawG, yGridG) {
  drawG.selectAll('.single-track-layer').remove();
  drawG.selectAll('.service-layer').remove();
  drawG.selectAll('.node-layer').remove();
  drawG.selectAll('.hitarea-layer').remove();
  yGridG.selectAll('*').remove();
}

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

/** Render X-axis labels and grid (uses current zoom transform). */
function renderXAxis(xAxisG, xGridG, xScale, innerW, innerH) {
  if (!chartState.svg) return;
  const zt = d3.zoomTransform(chartState.svg.node());
  const rx = zt.rescaleX(xScale);
  const tickCount = Math.max(2, Math.floor(innerW / (80 * zt.k)));

  xAxisG.call(
    d3.axisBottom(rx)
      .tickFormat(d => formatTimeHHMM(d))
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

/** Render empty chart with axis lines but no service data. */
function renderEmptyChart(corridorNodes, corridorPositions,
    yScale, yAxisG, yGridG, xScale, xAxisG, xGridG, innerW, innerH) {
  setupYScaleDomain(corridorNodes, yScale, innerH);

  const xMin = STATE.timeFilterStart !== null ? STATE.timeFilterStart : 0;
  const xMax = STATE.timeFilterEnd   !== null ? STATE.timeFilterEnd   : 1440;
  setupXScaleDomain(xScale, innerW, xMin, xMax);

  updateYAxis(corridorNodes, corridorPositions, yScale, yAxisG, yGridG, innerW);
  renderXAxis(xAxisG, xGridG, xScale, innerW, innerH);
}

/** Draw single-track segments as red dashed bands. */
function renderSingleTrackLayer(drawG, stSegs, xScale, yScale, tMin, tMax) {
  if (!stSegs || stSegs.length === 0) return;

  const stLayer = drawG.append('g').attr('class', 'single-track-layer');
  const xFull = xScale(tMax) - xScale(tMin);

  stSegs.forEach(seg => {
    const y1 = yScale(seg.fromKm);
    const y2 = yScale(seg.toKm);
    const yTop = Math.min(y1, y2);
    const yH = Math.abs(y2 - y1);

    stLayer.append('rect')
      .attr('x', xScale(tMin))
      .attr('y', yTop)
      .attr('width', xFull)
      .attr('height', Math.max(yH, 1))
      .attr('fill', 'rgba(239, 68, 68, 0.10)')
      .attr('stroke', 'rgba(239, 68, 68, 0.22)')
      .attr('stroke-width', 0.5)
      .attr('stroke-dasharray', '6 4');
  });
}

/** Draw visible service polylines and invisible hit areas. */
function renderServicePaths(drawG, corridorNodes, corridorPositions, xScale, yScale) {
  const plansLayer = drawG.append('g').attr('class', 'service-layer');
  const hitareaLayer = drawG.append('g').attr('class', 'hitarea-layer');

  if (!chartState._serviceData) chartState._serviceData = [];
  chartState._serviceData = [];

  STATE.servicePlans.filter(p => p.visible).forEach(plan => {
    plan.services.forEach((svc, svcIdx) => {
      const points = buildServicePoints(svc, corridorNodes, corridorPositions);
      if (points.length < 2) return;

      const isSelected = STATE.selectedService &&
        STATE.selectedService.planId === plan.id &&
        STATE.selectedService.serviceIndex === svcIdx;

      const lineGen = d3.line()
        .x(d => xScale(d[0]))
        .y(d => yScale(d[1]));

      // Visible service path (create first to cache reference)
      const pathClass = `path-${plan.id.replace(/[^a-zA-Z0-9]/g, '')}-${svcIdx}`;
      const pathEl = plansLayer.append('path')
        .datum(points)
        .attr('d', lineGen)
        .attr('class', `service-path ${pathClass}${isSelected ? ' selected' : ''}`)
        .attr('stroke', plan.color)
        .attr('opacity', isSelected ? 1 : 0.75)
        .attr('data-plan-id', plan.id)
        .attr('data-svc-idx', svcIdx)
        .on('mouseover', function(event) {
          if (STATE.selectedService &&
            STATE.selectedService.planId === plan.id &&
            STATE.selectedService.serviceIndex === svcIdx) return;
          d3.select(this).attr('stroke-width', 3).attr('opacity', 1);
        })
        .on('mouseout', function() {
          if (STATE.selectedService &&
            STATE.selectedService.planId === plan.id &&
            STATE.selectedService.serviceIndex === svcIdx) return;
          d3.select(this).attr('stroke-width', 1.8).attr('opacity', 0.75);
        })
        .on('click', (event) => { event.stopPropagation(); selectService(plan.id, svcIdx); });

      // Store metadata for drag updates (include cached path element ref)
      chartState._serviceData.push({
        plan, svc, svcIdx, points, isSelected, lineGen,
        planId: plan.id, serviceKey: plan.serviceKey,
        pathEl
      });

      // Invisible wide hit area for easier clicking
      hitareaLayer.append('path')
        .datum(points)
        .attr('d', lineGen)
        .attr('class', 'service-hitarea')
        .on('click', (event) => { event.stopPropagation(); selectService(plan.id, svcIdx); });
    });
  });
}

/** Draw draggable nodes for the currently selected service only. */
function renderSelectedServiceNodes(drawG, corridorNodes, corridorPositions, xScale, yScale) {
  if (!STATE.selectedService) return;

  const selData = chartState._serviceData.find(d =>
    d.planId === STATE.selectedService.planId &&
    d.svcIdx === STATE.selectedService.serviceIndex
  );
  if (!selData) return;

  const nodesLayer = drawG.append('g').attr('class', 'node-layer');
  renderDraggableNodes(nodesLayer, selData, corridorNodes, corridorPositions, xScale, yScale);
}

// =============================================================
// ZOOM & AXIS HELPERS
// =============================================================

function applyZoomScale() {
  if (!chartState.svg) return;
  const t = d3.zoomTransform(chartState.svg.node());
  if (t.k === 1 && t.x === 0 && t.y === 0) return; // identity, nothing to do
  const ik = 1 / t.k;
  chartState.zoomG.selectAll('.service-path').style('stroke-width', (1.8 * ik) + 'px');
  chartState.zoomG.selectAll('.service-path.selected').style('stroke-width', (3.2 * ik) + 'px');
  chartState.zoomG.selectAll('.service-hitarea').style('stroke-width', (14 * ik) + 'px');
  chartState.zoomG.selectAll('.node-dot')
    .attr('r', 5 * ik)
    .style('stroke-width', (1.5 * ik) + 'px');
}

function updateYAxis(corridorNodes, corridorPositions, yScale, yAxisG, yGridG, innerW) {
  // Y axis with station labels (drawn inside yAxisG, which is in zoomG)
  yAxisG.call(d3.axisLeft(yScale)
    .tickValues(corridorNodes.map(n => n.km))
    .tickFormat(d => {
      const node = corridorNodes.find(n => n.km === d);
      return node ? node.name : '';
    })
  );

  // Horizontal grid lines (drawn in yGridG, inside zoomG)
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

// =============================================================
// SERVICE PATH & NODE GEOMETRY
// =============================================================

// Build polyline points for a service — only at stations that belong to the corridor
function buildServicePoints(svc, corridorNodes, corridorPositions) {
  const points = [];
  svc.times.forEach((t, idx) => {
    const km = corridorPositions[t.node];
    if (km === undefined) return; // station not in this corridor — skip
    points.push({ t: t.arr, km, node: t.node, stationIdx: idx, isArrival: true });
    points.push({ t: t.dep, km, node: t.node, stationIdx: idx, isArrival: false });
  });
  return points.map(p => [p.t, p.km]);
}

// Render draggable nodes for a selected service (with smooth updates)
function renderDraggableNodes(nodesLayer, selData, corridorNodes, corridorPositions, xScale, yScale) {
  const { plan, svc, svcIdx, points } = selData;

  // Rebuild point metadata (only corridor stations)
  const pointMeta = [];
  svc.times.forEach((t, idx) => {
    const km = corridorPositions[t.node];
    if (km === undefined) return; // not in corridor
    pointMeta.push({ t: t.arr, km, node: t.node, stationIdx: idx, isArrival: true });
    pointMeta.push({ t: t.dep, km, node: t.node, stationIdx: idx, isArrival: false });
  });

  const circles = nodesLayer.selectAll('circle')
  .data(pointMeta)
  .join('circle')
  .attr('cx', d => xScale(d.t))
  .attr('cy', d => yScale(d.km))
  .attr('r', 5)
  .attr('fill', plan.color)
  .attr('stroke', '#fff')
  .attr('stroke-width', 1.5)
  .attr('class', 'node-dot')
  .attr('opacity', 1)
  .style('pointer-events', 'all')
  .style('cursor', 'ew-resize')
  .on('mouseover', function(event, d) {
    const tooltip = DOM.get('chart-tooltip');
    const eventType = d.isArrival ? 'Arr' : 'Dep';
    tooltip.innerHTML = `<b>${d.node}</b> ${eventType}: ${formatTimeHHMM(d.t)}`;
    tooltip.style.opacity = '1';
    tooltip.style.left = (event.clientX + 12) + 'px';
    tooltip.style.top = (event.clientY - 30) + 'px';
  })
  .on('mouseout', () => {
    DOM.get('chart-tooltip').style.opacity = '0';
  })
  .on('mousemove', (event) => {
    const tooltip = DOM.get('chart-tooltip');
    tooltip.style.left = (event.clientX + 12) + 'px';
    tooltip.style.top = (event.clientY - 30) + 'px';
  })
  .call(d3.drag()
    .on('start', function(event, d) {
      const t = d3.zoomTransform(chartState.svg.node());
      const ik = 1 / t.k;
      d3.select(this).attr('r', 7 * ik).raise();
      StateManager.beginTimeEdit();
      chartState._dragInfo = { svc, plan, d };
    })
    .on('drag', function(event, d) {
      const newX = event.x;
      const newTime = xScale.invert(newX);
      const constrained = constrainTime(svc, d.stationIdx, d.isArrival, newTime, plan.serviceKey);

      // Update data model (forward propagation — raw delta, no constraint check during drag)
      applyTimeRaw(svc, d.stationIdx, d.isArrival, constrained);

      // Update ALL node positions smoothly
      updateAllNodePositions(nodesLayer, svc, corridorPositions, plan.serviceKey, xScale, yScale);

      // Update the service path (uses cached path ref from _serviceData)
      const pathRef = chartState._serviceData.find(sd =>
        sd.planId === plan.id && sd.svcIdx === svcIdx
      );
      if (pathRef && pathRef.pathEl) {
        const pts = buildServicePoints(svc, corridorNodes, corridorPositions);
        pathRef.pathEl.attr('d', pathRef.lineGen(pts));
      }

      // Update tooltip
      const tooltip = DOM.get('chart-tooltip');
      const eventType = d.isArrival ? 'Arr' : 'Dep';
      const newVal = d.isArrival ? svc.times[d.stationIdx].arr : svc.times[d.stationIdx].dep;
      tooltip.innerHTML = `<b>${d.node}</b> ${eventType}: ${formatTimeHHMM(newVal)}`;
    })
    .on('end', function() {
      const t = d3.zoomTransform(chartState.svg.node());
      d3.select(this).attr('r', 5 / t.k);
      chartState._dragInfo = null;
      // Enforce constraints after drag completes
      enforceConstraints(svc, plan.serviceKey);
      // Update detail panel only once at the end
      updateDetailPanel();
      StateManager.endTimeEdit();
    })
  );
}

// Smoothly update all node circle positions during drag
function updateAllNodePositions(nodesLayer, svc, corridorPositions, serviceKey, xScale, yScale) {
  nodesLayer.selectAll('circle').each(function(d) {
    const timeEntry = svc.times[d.stationIdx];
    if (!timeEntry) return;
    const t = d.isArrival ? timeEntry.arr : timeEntry.dep;
    const km = corridorPositions[d.node];
    if (km === undefined) return;

    d3.select(this)
      .attr('cx', xScale(t))
      .attr('cy', yScale(km));
  });
}

// Apply a raw time delta (no constraint enforcement — used during drag for speed).
// Constraints are enforced once on drag end.
function applyTimeRaw(svc, stationIdx, isArrival, newTime) {
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
}

// Smoothly update the service path during drag
function updateServicePath(svc, plan, svcIdx, corridorNodes, corridorPositions, xScale, yScale) {
  const points = buildServicePoints(svc, corridorNodes, corridorPositions);
  const lineGen = d3.line()
  .x(d => xScale(d[0]))
  .y(d => yScale(d[1]));

  const pathClass = `path-${plan.id.replace(/[^a-zA-Z0-9]/g, '')}-${svcIdx}`;
  chartState.drawG.selectAll(`.${pathClass}`).attr('d', lineGen(points));
}

// =============================================================
// SELECTION & LEGEND
// =============================================================

function selectService(planId, serviceIndex) {
  StateManager.selectService(planId, serviceIndex);
}

function highlightSelectedService() {
  // Selection is handled during updateChart via CSS class 'selected'
  // and via renderDraggableNodes for the selected service only.
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
