// =============================================================
// UTILITY FUNCTIONS
// =============================================================

/**
 * Escape a string for safe interpolation into innerHTML.
 * @param {*} value — Any value; coerced to string.
 * @returns {string} HTML-escaped text.
 */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format minutes from midnight as HH:MM:SS string.
 * @param {number} minutes — Minutes since midnight (fractional OK).
 * @returns {string} e.g. "06:30:00"
 */
export function formatTimeHMS(minutes) {
  const totalSeconds = Math.round(minutes * 60);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Format minutes from midnight as HH:MM (hours may exceed 23). Negative
 * minutes-within-the-hour are wrapped so axis ticks below zero stay sane.
 * @param {number} minutes — Minutes since midnight.
 * @returns {string} e.g. "06:30"
 */
export function formatTimeHM(minutes) {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const mm = ((m % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Format a duration in minutes as "Mm SSs" (used in the shift tooltip).
 * @param {number} min — Duration in minutes.
 * @returns {string} e.g. "3m 05s"
 */
export function formatDuration(min) {
  const totalSec = Math.round(min * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/**
 * Parse "HH:MM" or "HH:MM:SS" to minutes from midnight. Validates format
 * and field ranges (minutes/seconds 0–59); hours may exceed 23 to allow
 * times past midnight.
 * @param {string} str — Time string like "06:30" or "14:05:30".
 * @returns {number} Minutes from midnight, or NaN if invalid.
 */
export function parseTimeHHMM(str) {
  const match = /^(\d{1,3}):([0-5]?\d)(?::([0-5]?\d))?$/.exec(String(str).trim());
  if (!match) return NaN;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const s = match[3] !== undefined ? parseInt(match[3], 10) : 0;
  return h * 60 + m + s / 60;
}

/**
 * Show a toast notification in the bottom-right corner.
 * @param {string} msg — Message text.
 * @param {boolean} [isError=false] — If true, uses red background.
 */
export function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (isError ? ' error' : '');
  clearTimeout(el._timeout);
  el._timeout = setTimeout(() => (el.className = ''), 2200);
}

/** Show a modal overlay by id and move focus to its first focusable control. */
export function openModal(id) {
  const modal = document.getElementById(id);
  modal.style.display = 'flex';
  const focusable = modal.querySelector(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
  );
  if (focusable) focusable.focus();
}

/** Hide a modal overlay by id. */
export function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

/** Generate a unique plan ID. */
export function generateId() {
  return 'plan-' + crypto.randomUUID();
}
