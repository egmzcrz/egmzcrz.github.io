const KMH_TO_MS = 1 / 3.6;
const MS_TO_KMH = 3.6;

let latestSimulationData = null;

Module.onRuntimeInitialized = () => {
  document.getElementById('btnRun').addEventListener('click', runSimulation);
  document.getElementById('btnExport').addEventListener('click', exportToCsv);
};

async function runSimulation() {
  const fileCsv = document.getElementById('fileCsv').files[0];
  const fileYaml = document.getElementById('fileYaml').files[0];

  if (!fileCsv || !fileYaml) {
    alert("Upload both CSV and YAML files.");
    return;
  }

  const ppkm = parseInt(document.getElementById('ppkm').value);
  const dwell = parseFloat(document.getElementById('dwell').value);
  const isReversed = document.getElementById('reverse').checked;

  try {
    const csvText = await fileCsv.text();
    const yamlText = await fileYaml.text();

    const train = parseTrainYaml(yamlText);
    const path = parseAndInterpolatePath(csvText, dwell, ppkm, isReversed);

    // 1. Compute
    const simResults = executeWasmSim(train, path);

    // 2. Save State
    latestSimulationData = simResults;

    // 3. Update UI
    updateUI(train.name, simResults);

    // 4. Render
    renderPlots(simResults, path);

  } catch (e) {
    console.error("Simulation Error:", e);
    alert("Error running simulation: " + e.message);
  }
}

function parseTrainYaml(yamlText) {
  const data = jsyaml.load(yamlText);

  return {
    ...data, // Inherits mass, adh_mass, davis_a, etc.
    trac_v: data.tractive_effort_table.map(row => row[0] * KMH_TO_MS),
    trac_f: data.tractive_effort_table.map(row => row[1]),
    brake_v: data.braking_curve_table.map(row => row[0] * KMH_TO_MS),
    brake_a: data.braking_curve_table.map(row => row[1])
  };
}

function parseAndInterpolatePath(csvText, dwellTime, ppkm, isReversed) {
  const lines = csvText.trim().split('\n').filter(l => l.trim() !== "");
  lines.shift(); // Drop header

  const raw = lines.map(line => {
    const p = line.split(',');
    return {
      x: parseFloat(p[0]),
      vlim: parseFloat(p[1]) * KMH_TO_MS,
      curve: parseFloat(p[2]),
      slope: parseFloat(p[3]),
      station: p[4] ? p[4].trim() : ""
    };
  });

  let pos = [], vlim = [], curve = [], slope = [], is_station = [], dwell = [], st_name_arr = [];
  let st_pos = [], st_names = [];

  const isValidStation = (name) => name !== "" && name.toLowerCase() !== "nan";

  for (let i = 0; i < raw.length - 1; i++) {
    const cur = raw[i], nxt = raw[i + 1];
    const has_st = isValidStation(cur.station);

    if (has_st) {
      st_pos.push(cur.x);
      st_names.push(cur.station);
    }

    const dx = nxt.x - cur.x;
    const n_points = Math.ceil(dx * (ppkm / 1000.0));
    const step = dx / n_points;

    for (let j = 0; j < n_points; j++) {
      pos.push(cur.x + j * step);
      vlim.push(cur.vlim);
      curve.push(cur.curve);
      slope.push(cur.slope);
      is_station.push(has_st ? 1.0 : 0.0);
      dwell.push(has_st ? (dwellTime / n_points) : 0.0);
      st_name_arr.push(has_st ? cur.station : "");
    }
  }

  // Handle last point
  const last = raw[raw.length - 1];
  const last_has_st = isValidStation(last.station);

  pos.push(last.x);
  vlim.push(last.vlim);
  curve.push(last.curve);
  slope.push(last.slope);
  is_station.push(1.0);
  dwell.push(dwellTime);
  st_name_arr.push(last_has_st ? last.station : "");

  st_pos.push(last.x);
  st_names.push(last.station);

  if (isReversed) {
    const offset = pos[pos.length - 1] + pos[0];
    pos = pos.map(x => offset - x).reverse();
    vlim = vlim.reverse();
    slope = slope.map(s => -s).reverse();
    curve = curve.map(c => -c).reverse();
    is_station = is_station.reverse();
    dwell = dwell.reverse();
    st_name_arr = st_name_arr.reverse();

    st_pos = st_pos.map(x => offset - x).reverse();
    st_names = st_names.reverse();
  }

  return { pos, vlim, curve, slope, is_station, dwell, st_pos, st_names, st_name_arr };
}

function executeWasmSim(train, path) {
  const n = path.pos.length;
  const pointersToFree = [];

  const allocArr = (arr) => {
    const ptr = Module._malloc(arr.length * 8);
    Module.HEAPF64.set(arr, ptr / 8); 
    pointersToFree.push(ptr);
    return ptr;
  };

  try {
    // 1. Allocate Input Memory
    const ptr_pos = allocArr(new Float64Array(path.pos));
    const ptr_vlim = allocArr(new Float64Array(path.vlim));
    const ptr_slope = allocArr(new Float64Array(path.slope));
    const ptr_curve = allocArr(new Float64Array(path.curve));
    const ptr_stmask = allocArr(new Float64Array(path.is_station));
    const ptr_dwell = allocArr(new Float64Array(path.dwell));

    const ptr_trac_v = allocArr(new Float64Array(train.trac_v));
    const ptr_trac_f = allocArr(new Float64Array(train.trac_f));
    const ptr_brake_v = allocArr(new Float64Array(train.brake_v));
    const ptr_brake_a = allocArr(new Float64Array(train.brake_a));

    // 2. Allocate Output Memory
    const ptr_out_v = allocArr(new Float64Array(n));
    const ptr_out_time = allocArr(new Float64Array(n));
    const ptr_out_energy = allocArr(new Float64Array(n));
    const ptr_out_force = allocArr(new Float64Array(n));

    // 3. Execute WASM
    Module.ccall('run_simulation', null, 
      ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [n, ptr_pos, ptr_vlim, ptr_slope, ptr_curve, ptr_stmask, ptr_dwell, train.mass, train.adh_mass, train.rotational_inertia, train.davis_a, train.davis_b, train.davis_c, train.trac_v.length, ptr_trac_v, ptr_trac_f, train.brake_v.length, ptr_brake_v, ptr_brake_a, ptr_out_v, ptr_out_time, ptr_out_energy, ptr_out_force]
    );

    // 4. Extract Data
    const out_v = new Float64Array(Module.HEAPF64.buffer, ptr_out_v, n);
    const out_time = new Float64Array(Module.HEAPF64.buffer, ptr_out_time, n);
    const out_energy = new Float64Array(Module.HEAPF64.buffer, ptr_out_energy, n);

    return {
      dist: path.pos.map(p => p / 1000.0),
      vel: Array.from(out_v).map(v => v * MS_TO_KMH),
      time: Array.from(out_time).map(t => t / 60.0),
      energy: Array.from(out_energy).map(e => e / 1e6),
      vlim: path.vlim.map(v => v * MS_TO_KMH),
      slope: path.slope,
      curve: path.curve,
      stations: path.st_name_arr
    };

  } finally {
    // 5. Memory Cleanup
    pointersToFree.forEach(p => Module._free(p));
  }
}

function updateUI(trainName, data) {
  const n = data.time.length;
  const totalTime = data.time[n - 1];
  const mins = Math.floor(totalTime);
  const secs = Math.round((totalTime - mins) * 60);

  document.getElementById('resName').innerText = trainName;
  document.getElementById('resTime').innerText = `${mins} min ${secs} sec`;
  document.getElementById('resEnergy').innerText = `${data.energy[n - 1].toFixed(2)} MJ`;

  document.getElementById('resultsBox').style.display = 'block';
  document.getElementById('btnExport').style.display = 'block';
}

function exportToCsv() {
  if (!latestSimulationData) return;

  const { dist, vel, time, energy, vlim, slope, curve, stations } = latestSimulationData;

  const header = "Distance [km],Speed [km/h],Speed Limit [km/h],Time [min],Energy [MJ],Slope [per mille],Curve [m],Station";

  const rows = dist.map((d, i) => 
    `${d.toFixed(5)},${vel[i].toFixed(2)},${vlim[i].toFixed(2)},${time[i].toFixed(4)},${energy[i].toFixed(4)},${slope[i].toFixed(2)},${curve[i].toFixed(6)},"${stations[i] || ""}"`
  );

  const csvContent = [header, ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "simulation_profile.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function renderPlots(simData, path) {
  const { dist, vel, time, energy } = simData;
  const curv_inv = path.curve.map(c => c === 0 ? 0 : 1 / c);
  const speed_lims = path.vlim.map(v => v * MS_TO_KMH);

  const slopePos = path.slope.map(s => s > 0 ? s : 0);
  const slopeNeg = path.slope.map(s => s < 0 ? s : 0);

  const shapes = path.st_pos.map((pos) => ({
    type: 'line', x0: pos/1000, x1: pos/1000, y0: 0, y1: 1, yref: 'paper',
    line: { color: 'darkblue', width: 0.2, dash: 'dot' }
  }));

  const annotations = path.st_names.map((name, i) => {
    const distKm = (path.st_pos[i] / 1000).toFixed(2);
    return {
      x: path.st_pos[i] / 1000, y: 0.02, yref: 'paper',
      text: `${name} (${distKm})`, textangle: -90, showarrow: false,
      font: {size: 9, color: 'darkblue'}, xanchor: 'right'
    };
  });

  const traceSlopePos = { x: dist, y: slopePos, type: 'scatter', mode: 'lines', line: {shape: 'hv', width: 0}, fill: 'tozeroy', fillcolor: 'rgba(255,0,0,0.4)', xaxis: 'x', yaxis: 'y1', hoverinfo: 'skip' };
  const traceSlopeNeg = { x: dist, y: slopeNeg, type: 'scatter', mode: 'lines', line: {shape: 'hv', width: 0}, fill: 'tozeroy', fillcolor: 'rgba(0,180,0,0.4)', xaxis: 'x', yaxis: 'y1', hoverinfo: 'skip' };
  const traceSlopeLine = { x: dist, y: path.slope, type: 'scatter', mode: 'lines', line: {shape: 'hv', color: 'black', width: 0.8}, xaxis: 'x', yaxis: 'y1', name: 'Slope [‰]' };
  const traceCurv = { x: dist, y: curv_inv, type: 'scatter', mode: 'lines', line: {shape: 'hv', color: 'black', width: 0.8}, fill: 'tozeroy', fillcolor: 'rgba(255,0,0,0.4)', xaxis: 'x', yaxis: 'y2', name: 'Curvature [1/m]' };
  const traceVLim = { x: dist, y: speed_lims, type: 'scatter', mode: 'lines', line: {shape: 'hv', color: 'rgba(255,0,0,0.6)', width: 1.3}, xaxis: 'x', yaxis: 'y3', name: 'Limit [km/h]' };
  const traceVel = { x: dist, y: vel, type: 'scatter', mode: 'lines', line: {color: 'black', width: 1.3}, xaxis: 'x', yaxis: 'y3', name: 'Speed [km/h]' };
  const traceEng = { x: dist, y: energy, type: 'scatter', mode: 'lines', line: {color: 'black', width: 1.3}, xaxis: 'x', yaxis: 'y4', name: 'Energy [MJ]' };
  const traceTime = { x: dist, y: time, type: 'scatter', mode: 'lines', line: {color: 'black', width: 1.3}, xaxis: 'x', yaxis: 'y5', name: 'Time [min]' };

  const layout = {
    grid: { rows: 5, columns: 1, pattern: 'coupled' }, font: { size: 9 },
    margin: { t: 10, b: 60, l: 60, r: 10 }, showlegend: false,
    shapes: shapes, annotations: annotations,
    yaxis1: { title: "Slope [‰]" }, yaxis2: { title: "Curv. [1/m]" },
    yaxis3: { title: "Vel. [km/h]" }, yaxis4: { title: "Energy [MJ]" },
    yaxis5: { title: "Time [min]" }, xaxis: { title: "Distance [km]" }
  };

  Plotly.newPlot('plot', [traceSlopePos, traceSlopeNeg, traceSlopeLine, traceCurv, traceVLim, traceVel, traceEng, traceTime], layout, {responsive: true});
}
