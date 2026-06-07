// =============================================================
// FILE INPUT — welcome overlay & file-reading helper
//
// Input is a track-geometry CSV + a rolling-stock YAML, supplied through
// the "Add Service Plan" modal (see plans.js). The full-screen overlay is
// just a welcome prompt that opens that modal.
// =============================================================
import { DOM } from './dom.js';
import { openAddPlanModal } from './plans.js';

/** Read a File as text. Returns a Promise<string>. */
export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Could not read ' + file.name));
    reader.readAsText(file);
  });
}

// Welcome overlay → opens the Add Service Plan modal.
// Called once from app init (after the DOM is ready).
export function initWelcomeOverlay() {
  const card = DOM.get('upload-card');
  if (card) card.addEventListener('click', openAddPlanModal);
}
