// =============================================================
// CONSTANTS
// =============================================================

// Line colors cycled through as service plans are added.
export const PLAN_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
  '#84cc16', '#e11d48', '#0ea5e9', '#a855f7', '#d946ef'
];

// ---- Scheduling ----
// Minutes in a day; trips are generated up to this offset from midnight.
export const DAY_END_MIN = 1440;

// Default values for a new service plan (mirrored by the Add Plan modal
// inputs, which are populated from here so there's a single source of truth).
export const PLAN_DEFAULTS = {
  headwayMin: 15,
  startOffsetMin: 360, // 06:00
  dwellSec: 30,
  direction: 'both'
};

// Default signaling-block length (metres) for a new service. Each service
// carries its own length; this is the starting value and the fallback for
// any service that predates the per-service block fields.
export const DEFAULT_BLOCK_LENGTH_M = 1500;

// ---- Physics ----
// Gravitational acceleration [m/s²], shared by the engine and dynamics.
export const G = 9.81;

// Unit conversions
export const KMH_TO_MS = 1 / 3.6;
export const MS_TO_KMH = 3.6;

// Spatial discretisation for the physics simulation (points per km).
// Matches trainrun's ppkm=1000 (1 point per metre) so the computed
// dynamics are at full resolution. The plot thins points separately
// (PLOT_MAX_SEG_POINTS), so this only affects simulation accuracy, not
// render performance.
export const SIM_PPKM = 1000;

// Plotting downsample cap: max points kept per inter-station segment of
// the high-resolution curve (endpoints always preserved). Keeps the SVG
// light even with many services without visibly altering the curve.
export const PLOT_MAX_SEG_POINTS = 10;
