// =============================================================
// UTILITY FUNCTIONS
// =============================================================

/**
 * Format minutes from midnight as HH:MM:SS string.
 * @param {number} minutes — Minutes since midnight (fractional OK).
 * @returns {string} e.g. "06:30:00"
 */
function formatTimeHHMM(minutes) {
  const totalSeconds = Math.round(minutes * 60);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Parse HH:MM or HH:MM:SS string to minutes from midnight.
 * @param {string} str — Time string like "06:30" or "14:05:30".
 * @returns {number} Minutes from midnight, or NaN if invalid.
 */
function parseTimeHHMM(str) {
  const parts = str.split(':');
  if (parts.length === 3) {
    return parseInt(parts[0]) * 60 + parseInt(parts[1]) + parseInt(parts[2]) / 60;
  }
  if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  }
  return NaN;
}

/**
 * Show a toast notification in the bottom-right corner.
 * @param {string} msg — Message text.
 * @param {boolean} [isError=false] — If true, uses red background.
 */
function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (isError ? ' error' : '');
  clearTimeout(el._timeout);
  el._timeout = setTimeout(() => el.className = '', 2200);
}

/** Show a modal overlay by id. */
function openModal(id) {
  document.getElementById(id).style.display = 'flex';
}

/** Hide a modal overlay by id. */
function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

/** Generate a unique plan ID. */
function generateId() {
  return 'plan-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}
