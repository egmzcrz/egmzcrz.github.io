// --- Constants & Global State ---
const BASE_DATE_STR = "2026-05-01T00:00:00";
const DEFAULT_HOURS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
const PLOTLY_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#8b5cf6', '#f97316', '#06b6d4', '#ec4899', '#84cc16', '#d946ef', '#eab308'];
const MIN_TO_MS = 60000;
const DEFAULT_START_OFFSET_MINS = 360; // 6:00 AM

let networkData = {};
let activeLine = null; 
let activeCorridor = null; 
let configs = {}; 

// --- DOM Elements ---
const fileUpload = document.getElementById('file-upload');
const editorControls = document.getElementById('editor-controls');
const lineSelect = document.getElementById('line-select');
const corridorSelect = document.getElementById('corridor-select');
const offsetSlider = document.getElementById('start-offset-slider');
const offsetNumber = document.getElementById('start-offset-number');
const offsetDisplay = document.getElementById('offset-display');
const intervalsGrid = document.getElementById('intervals-grid');
const chartContainer = document.getElementById('chart-container');

// --- 1. File I/O & Data Processing ---
fileUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const data = new Uint8Array(e.target.result);
    const workbook = XLSX.read(data, { type: 'array' });

    if (processWorkbookData(workbook)) {
      initUI();
    } else {
      alert("No valid line data found in Excel sheets.");
    }
  };
  reader.readAsArrayBuffer(file);
});

function processWorkbookData(workbook) {
  networkData = {};
  configs = {};
  let hasData = false;

  workbook.SheetNames.forEach(sheetName => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    if (rows.length === 0 || !("Station_name" in rows[0])) return;

    hasData = true;
    const nodes = [];
    const position = {};
    const dwell_time = {};
    const running_time = {};

    // Extract Nodes & Times
    rows.forEach(row => {
      const station = row["Station_name"];
      nodes.push(station);
      position[station] = parseFloat(row["Distance [km]"]);
      dwell_time[station] = parseFloat(row["Dwell_Time [s]"]) / 60.0;
    });

    // Calculate Edges (Running Times)
    for (let i = 0; i < rows.length - 1; i++) {
      const current = rows[i], next = rows[i+1];
      const safe_rt = Math.max(parseFloat(next["Time [min]"]) - parseFloat(current["Time [min]"]), 0.1);
      running_time[`${nodes[i]}|${nodes[i+1]}`] = safe_rt;
      running_time[`${nodes[i+1]}|${nodes[i]}`] = safe_rt;
    }

    networkData[sheetName] = { nodes, position, dwell_time, running_time };

    // Setup Configs
    configs[sheetName] = { startOffset: DEFAULT_START_OFFSET_MINS, intervals: {} };
    DEFAULT_HOURS.forEach(h => configs[sheetName].intervals[h] = 0);
    [6, 7, 8, 9].forEach(h => configs[sheetName].intervals[h] = 30); // Demo defaults
  });

  return hasData;
}

// --- 2. UI Initialization & Event Binding ---
function initUI() {
  lineSelect.innerHTML = '';
  corridorSelect.innerHTML = '';

  Object.keys(networkData).forEach(line => {
    lineSelect.add(new Option(line, line));
    corridorSelect.add(new Option(line, line));
  });

  // Default to bue-ira if it exists
  corridorSelect.value = networkData['bue-ira'] ? 'bue-ira' : Object.keys(networkData)[0];

  activeLine = lineSelect.value;
  activeCorridor = corridorSelect.value;
  editorControls.style.display = 'flex';

  // Bind Listeners
  lineSelect.onchange = (e) => { activeLine = e.target.value; loadControlsForActiveLine(); };
  corridorSelect.onchange = (e) => { activeCorridor = e.target.value; updateChart(); };

  offsetSlider.oninput = (e) => {
    const val = parseInt(e.target.value);
    configs[activeLine].startOffset = val;
    offsetDisplay.textContent = `${val} mins (${Math.floor(val / 60).toString().padStart(2, '0')}:${(val % 60).toString().padStart(2, '0')})`;
    updateChart();
  };
    // Offset handler
    const handleOffsetChange = (val) => {
        // Clamp the value to ensure manual typing doesn't break the 0-1440 bound
        let safeVal = Math.max(0, Math.min(1440, parseInt(val) || 0));
        
        configs[activeLine].startOffset = safeVal;
        
        // Keep both UI elements synced
        offsetSlider.value = safeVal;
        offsetNumber.value = safeVal;
        
        // Update the human-readable clock display
        const hours = Math.floor(safeVal / 60).toString().padStart(2, '0');
        const mins = (safeVal % 60).toString().padStart(2, '0');
        offsetDisplay.textContent = `${hours}:${mins}`;
        
        updateChart();
    };

    // Bind both inputs to the same handler
    offsetSlider.oninput = (e) => handleOffsetChange(e.target.value);
    offsetNumber.oninput = (e) => handleOffsetChange(e.target.value);

  loadControlsForActiveLine();
  updateChart();
}

function loadControlsForActiveLine() {
  const config = configs[activeLine];

  offsetSlider.value = config.startOffset;
    offsetNumber.value = config.startOffset;
  offsetSlider.dispatchEvent(new Event('input')); 

  intervalsGrid.innerHTML = '';
  Object.keys(config.intervals).sort((a,b) => a-b).forEach(hour => {
    const wrapper = document.createElement('div');
    wrapper.className = 'interval-box';

    const label = document.createElement('label');
    label.textContent = `${hour}:00`;

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.value = config.intervals[hour];

    input.oninput = (e) => {
      configs[activeLine].intervals[hour] = parseInt(e.target.value) || 0;
      updateChart();
    };

    wrapper.append(label, input);
    intervalsGrid.appendChild(wrapper);
  });
}

// --- 3. Timetable Core Logic ---
function getDispatchTimes(config) {
  const dispatchTimes = [];
  let currentDispatch = new Date(new Date(BASE_DATE_STR).getTime() + config.startOffset * MIN_TO_MS);

  const hoursConfigured = Object.keys(config.intervals).map(Number);
  if (hoursConfigured.length === 0) return dispatchTimes;

  const endTime = new Date(BASE_DATE_STR);
  endTime.setHours(Math.max(...hoursConfigured), 59, 59);

  while (currentDispatch <= endTime) {
    const currentHour = currentDispatch.getHours();
    const intervalMins = config.intervals[currentHour];

    if (intervalMins > 0) {
      dispatchTimes.push(new Date(currentDispatch));
      currentDispatch = new Date(currentDispatch.getTime() + intervalMins * MIN_TO_MS);
    } else {
      currentDispatch.setHours(currentHour + 1, 0, 0, 0);
    }
  }
  return dispatchTimes;
}

function simulateRun(startTime, nodeSequence, serviceId, data, corridorPositions, direction, lineId, color) {
  let currentTime = new Date(startTime);
  let xData = [], yData = [], textData = [], hoverData = [];

  // Helper to log points and generate the custom hover string
  const pushPoint = (time, node, pos, isFirst) => {
    if (pos === undefined) return;
    xData.push(formatDateForPlotly(time));
    yData.push(pos);
    textData.push(isFirst ? serviceId.toString() : '');

    // Format time as HH:MM:SS
    const timeStr = String(time.getHours()).padStart(2, '0') + ':' + 
      String(time.getMinutes()).padStart(2, '0') + ':' + 
      String(time.getSeconds()).padStart(2, '0');

    // Exact verbatim string formatting requested
    hoverData.push(`${timeStr}, ${node}<br>${lineId} service<br>service id: ${serviceId}`);
  };

  for (let j = 0; j < nodeSequence.length; j++) {
    const currentNode = nodeSequence[j];
    const pos = corridorPositions[currentNode];

    // 1. Arrival
    pushPoint(currentTime, currentNode, pos, xData.length === 0);

    // 2. Dwell
    const dwell = (j === 0 && direction === 'North') ? 0 : (data.dwell_time[currentNode] || 0);
    if (dwell > 0) {
      currentTime = new Date(currentTime.getTime() + dwell * MIN_TO_MS);
      pushPoint(currentTime, currentNode, pos, false);
    }

    // 3. Transit to next node
    if (j < nodeSequence.length - 1) {
      const nextNode = nodeSequence[j+1];
      const rt = data.running_time[`${currentNode}|${nextNode}`] || 0;
      currentTime = new Date(currentTime.getTime() + rt * MIN_TO_MS);
    }
  }

  return xData.length > 0 ? buildTraceObject(xData, yData, textData, hoverData, serviceId, direction, lineId, color) : null;
}

function generateTracesForLine(lineId, color, corridorPositions) {
  const traces = [];
  const data = networkData[lineId];
  const dispatchTimes = getDispatchTimes(configs[lineId]);

  let evenCounter = 2; // Northbound
  let oddCounter = 1;  // Southbound

  dispatchTimes.forEach(startTime => {
    // Northbound Run
    const northTrace = simulateRun(startTime, data.nodes, evenCounter, data, corridorPositions, 'North', lineId, color);
    if (northTrace) traces.push(northTrace);
    evenCounter += 2;

    // Southbound Run
    const southTrace = simulateRun(startTime, [...data.nodes].reverse(), oddCounter, data, corridorPositions, 'South', lineId, color);
    if (southTrace) traces.push(southTrace);
    oddCounter += 2;
  });

  return traces;
}

// Added hovertext as a parameter
function buildTraceObject(x, y, text, hovertext, serviceId, direction, lineId, color) {
  return {
    x: x, y: y,
    mode: 'lines+markers+text',
    text: text,
    hovertext: hovertext, // Bind the custom HTML array
    textposition: 'top center',
    textfont: { size: 9, color: color },
    name: `${lineId} (ID: ${serviceId})`,
    legendgroup: lineId,
    legendgrouptitle: { text: lineId },
    line: { color: color, width: 1.5 },
    marker: { size: 4, color: color },
    hoverinfo: 'text' // Force Plotly to only use our custom hovertext
  };
}

function formatDateForPlotly(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// --- 4. Plotly Rendering ---
function updateChart() {
  if (!activeCorridor || !networkData[activeCorridor]) return;

  const allTraces = [];
  const corridorPositions = networkData[activeCorridor].position;

  Object.keys(networkData).forEach((lineId, index) => {
    const color = PLOTLY_COLORS[index % PLOTLY_COLORS.length];
    allTraces.push(...generateTracesForLine(lineId, color, corridorPositions));
  });

  const yTicks = [], yLabels = [];
  Object.keys(corridorPositions).forEach(node => {
    yLabels.push(node);
    yTicks.push(corridorPositions[node]);
  });

  const layout = {
    title: false,
    hovermode: 'closest',
    plot_bgcolor: 'transparent',
    paper_bgcolor: 'transparent',
    margin: { t: 30, r: 30, b: 30, l: 110 },
    font: { family: '"Inter", -apple-system, sans-serif', size: 10 },
    xaxis: { gridcolor: '#f3f4f6', showgrid: true, tickformat: '%H:%M', type: 'date', zeroline: false },
    yaxis: {
      tickmode: 'array', tickvals: yTicks, ticktext: yLabels,
      gridcolor: '#f3f4f6', showgrid: true, zeroline: false,
      //title: { text: 'Distance (km)', font: { color: '#6b7280' }, standoff: 20 }
    },
    showlegend: true,
    legend: { groupclick: 'toggleitem', bgcolor: 'rgba(255,255,255,0.8)', bordercolor: '#eaeaea', borderwidth: 1 },

    hoverlabel: {
      align: 'left',
      bgcolor: '#ffffff',
      bordercolor: '#eaeaea',
      font: { family: '"Inter", -apple-system, sans-serif', size: 12, color: '#111827' }
    }
  };

  Plotly.react(chartContainer, allTraces, layout, { responsive: true, displayModeBar: false });
}
