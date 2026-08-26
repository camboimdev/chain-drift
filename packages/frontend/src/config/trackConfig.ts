/**
 * Track Configuration - Forward Racing Track
 * Extracted to separate file to avoid circular imports
 */

export const TRACK_CONFIG = {
  totalDistance: 1200,     // Total race distance in meters
  trackWidth: 24,          // Width of the track
  laneCount: 6,            // Number of lanes
  chunkLength: 50,         // Length of each track chunk
  railHeight: 1.5,         // Height of side rails
  railWidth: 0.15,         // Width of side rails
  gridSize: 2,             // Size of grid squares
  visibleChunks: 8,        // How many chunks to render ahead
  behindChunks: 2,         // How many chunks to keep behind
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
