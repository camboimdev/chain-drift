/**
 * Track Configuration - Forward Racing Circuit
 * Extracted to a separate file to avoid circular imports.
 *
 * Cross-section (X, metres) — the drivable surface top is exactly y = 0:
 *
 *   |<-- apron -->|<- kerb ->|<---- asphalt ---->|<- kerb ->|<-- apron -->|
 *  wall         17.4       13.4        0        13.4      17.4          wall
 */

export const TRACK_CONFIG = {
  // ── Core geometry (consumed by the director, camera and store) ──
  totalDistance: 1200, // Total race distance in metres
  trackWidth: 24, // Width of the drivable asphalt
  laneCount: 6, // Number of racing lanes
  chunkLength: 50, // Length of each streamed track chunk
  visibleChunks: 8, // How many chunks to render ahead of the leader
  behindChunks: 2, // How many chunks to keep behind the leader

  // ── Asphalt surface ──
  surfaceTileLength: 25, // Metres of track covered by one asphalt texture tile
  surfaceTextureSize: 1024, // Albedo canvas resolution (power of two)
  surfaceVariants: 6, // Distinct texture offset/noise combinations

  // ── Kerbs (rumble strips) ──
  kerbWidth: 1.4,
  kerbHeight: 0.12,
  kerbStripeLength: 1.25, // Length of one red or white block

  // ── Run-off apron between kerb and barrier ──
  apronWidth: 4,

  // ── Barrier wall ──
  wallThickness: 0.6,
  wallHeight: 1.1,

  // ── Trackside furniture ──
  poleSpacing: 50, // Matches chunkLength: one light pole per chunk
  poleHeight: 8,
  markerSpacing: 100, // Distance-to-finish boards

  // ── Start / finish ──
  gridAreaLength: 18, // Painted starting-grid area (behind the start line)
  gridBoxLength: 5.2,
  gridBoxWidth: 2.8,
  finishBoardLength: 4, // Painted checkered board depth

  // ── Brand ──
  // Single accent, per the Chain Drift design system. Never mix accents.
  accent: "#00D1FF",
};

export const LANE_WIDTH = TRACK_CONFIG.trackWidth / TRACK_CONFIG.laneCount;

/**
 * Get lane center X position (0 = leftmost lane, laneCount-1 = rightmost)
 */
export function getLanePosition(laneIndex: number): number {
  const halfWidth = TRACK_CONFIG.trackWidth / 2;
  const laneOffset = (laneIndex + 0.5) * LANE_WIDTH;
  return -halfWidth + laneOffset;
}
