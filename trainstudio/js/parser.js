// =============================================================
// FILE UPLOAD & PARSING
// =============================================================
const fileInput = DOM.get('file-input');
const uploadCard = DOM.get('upload-card');
const uploadOverlay = DOM.get('upload-overlay');

uploadCard.addEventListener('click', () => fileInput.click());

uploadCard.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadCard.style.borderColor = 'var(--accent)';
  uploadCard.style.background = 'var(--accent-light)';
});
uploadCard.addEventListener('dragleave', () => {
  uploadCard.style.borderColor = 'var(--border)';
  uploadCard.style.background = '';
});
uploadCard.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadCard.style.borderColor = 'var(--border)';
  uploadCard.style.background = '';
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (file) processFile(file);
});

function processFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });

      const services = {};
      workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet);

        if (rows.length === 0) return;

        // Validate required columns exist
        const firstRow = rows[0];
        if (!firstRow['Station_name'] || firstRow['Distance [km]'] === undefined || firstRow['Time [min]'] === undefined) {
          showToast(`Sheet "${sheetName}" is missing required columns (Station_name, Distance [km], Time [min])`, true);
          return;
        }

        const nodes = [];
        const positions = {};
        const baseRunningTime = {};
        const baseDwellTime = {};
        const singleTrackSegments = [];

        rows.forEach((row, i) => {
          const name = row['Station_name'];
          const km = parseFloat(row['Distance [km]']);
          const timeMin = parseFloat(row['Time [min]']);
          const dwellS = parseFloat(row['Dwell_Time [s]']) || 0;

          // Skip rows with invalid numeric data
          if (isNaN(km) || isNaN(timeMin)) {
            console.warn(`Skipping row ${i + 1} in "${sheetName}": invalid numeric data`);
            return;
          }

          nodes.push({
            name,
            km,
            time_min: timeMin,
            dwell_s: dwellS,
            dwell_min: dwellS / 60
          });
          positions[name] = km;
          baseDwellTime[name] = dwellS / 60;  // minimum dwell in minutes

          if (i > 0) {
            const prevName = rows[i - 1]['Station_name'];
            const prevTime = parseFloat(rows[i - 1]['Time [min]']);
            const rt = Math.max(timeMin - prevTime, 0.1);
            baseRunningTime[`${prevName}→${name}`] = rt;

            // Track type: single-track segments get a red band
            const trackType = (row['track_type'] || '').toString().toLowerCase().trim();
            if (trackType === 'single') {
              const prevKm = parseFloat(rows[i - 1]['Distance [km]']);
              singleTrackSegments.push({
                fromStation: prevName,
                toStation: name,
                fromKm: prevKm,
                toKm: km
              });
            }
          }
        });

        services[sheetName] = { nodes, positions, baseRunningTime, baseDwellTime, singleTrackSegments };
      });

      if (Object.keys(services).length === 0) {
        showToast('No valid service sheets found in file', true);
        return;
      }

      StateManager.loadServices(services);

      // Enable UI
      DOM.get('corridor-select').disabled = false;
      DOM.get('btn-add-plan').disabled = false;
      DOM.get('btn-edit-plans').disabled = false;
      DOM.get('btn-download').disabled = false;

      populateCorridorSelect();
      populateAddPlanModal();
      uploadOverlay.style.display = 'none';

      showToast(`Loaded ${Object.keys(services).length} services`);
    } catch (err) {
      console.error(err);
      showToast('Error parsing file: ' + err.message, true);
    }
  };
  reader.readAsArrayBuffer(file);
}
