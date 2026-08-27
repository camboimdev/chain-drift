import type { CarNFT } from "@chain-drift/shared";

/**
 * Where every car in the fleet stands, for every mode.
 *
 * One pure function owns the whole arrangement: the carousel, the fleet grid
 * and the inspect stage are three answers from the same table. Bays lerp from
 * wherever they are to whatever this returns, so a mode switch is a re-layout
 * rather than a bespoke transition — and a car that is not on stage yet still
 * has a position to fly in from.
 */

export type GarageMode = "gallery" | "fleet" | "inspect";

/** Distance from the featured car, in stage terms. `offstage` is not rendered. */
export type BayTier = "hero" | "flank" | "queue" | "grid" | "offstage";

export interface Placement {
  pos:   [number, number, number];
  rotY:  number;
  scale: number;
  tier:  BayTier;
  /** 1-based position in the fleet — the number painted on the bay floor. */
  bay:   number;
}

// ─── Gallery ring ─────────────────────────────────────────────────────────────
// The featured car owns the middle of the frame; everything else recedes on a
// shallow arc so the carousel reads as depth rather than a row of thumbnails.

const HERO_ROT = -Math.PI / 6;

function galleryPlacement(offset: number, bay: number): Placement {
  const side = Math.sign(offset) || 1;
  const rank = Math.abs(offset);

  if (rank === 0) return { pos: [0, 0, 0], rotY: HERO_ROT, scale: 1, tier: "hero", bay };
  if (rank === 1)
    return { pos: [side * 12.6, 0, -7.6], rotY: -side * (Math.PI / 7), scale: 0.62, tier: "flank", bay };
  if (rank === 2)
    return { pos: [side * 21.5, 0, -14.5], rotY: -side * (Math.PI / 8), scale: 0.44, tier: "queue", bay };

  return { pos: [side * 28, 0, -16], rotY: -side * (Math.PI / 8), scale: 0.34, tier: "offstage", bay };
}

// ─── Fleet grid ───────────────────────────────────────────────────────────────

const GRID_SPACING_X = 8.8;
const GRID_SPACING_Z = 9.6;
const GRID_FRONT_Z   = 3;
const GRID_ROT       = -Math.PI / 5.5;
const GRID_SCALE     = 0.58;

/** Up to four abreast reads as a line-up; past five it reads as a spreadsheet. */
export function gridColumns(total: number): number {
  if (total <= 4) return Math.max(1, total);
  return Math.min(5, Math.ceil(Math.sqrt(total)));
}

export function gridRows(total: number): number {
  return Math.ceil(total / gridColumns(total));
}

/** Middle of the parked grid — what the fleet camera frames. */
export function gridCenterZ(total: number): number {
  return GRID_FRONT_Z - ((gridRows(total) - 1) * GRID_SPACING_Z) / 2;
}

function fleetPlacement(index: number, total: number, bay: number): Placement {
  const cols = gridColumns(total);
  const col  = index % cols;
  const row  = Math.floor(index / cols);

  return {
    pos:   [(col - (cols - 1) / 2) * GRID_SPACING_X, 0, GRID_FRONT_Z - row * GRID_SPACING_Z],
    rotY:  GRID_ROT,
    scale: GRID_SCALE,
    tier:  "grid",
    bay,
  };
}

// ─── Layout ───────────────────────────────────────────────────────────────────

/** Shortest signed distance from `index` to `i` around a ring of `total`. */
function ringOffset(i: number, index: number, total: number): number {
  let d = i - index;
  if (d >  total / 2) d -= total;
  if (d < -total / 2) d += total;
  return d;
}

/**
 * A placement for every car, keyed by car id.
 *
 * `inspect` parks the rest of the fleet offstage rather than hiding it, so
 * leaving the stage sends every other car back out the way it came in.
 */
export function computeLayout(
  cars: CarNFT[],
  index: number,
  mode: GarageMode
): Map<string, Placement> {
  const total = cars.length;
  const layout = new Map<string, Placement>();

  cars.forEach((car, i) => {
    const bay    = i + 1;
    const offset = ringOffset(i, index, total);

    if (mode === "fleet") {
      layout.set(car.id, fleetPlacement(i, total, bay));
    } else if (mode === "inspect") {
      layout.set(
        car.id,
        i === index
          ? { pos: [0, 0, 0], rotY: HERO_ROT, scale: 1, tier: "hero", bay }
          : { ...galleryPlacement(offset, bay), tier: "offstage" }
      );
    } else {
      layout.set(car.id, galleryPlacement(offset, bay));
    }
  });

  return layout;
}

/**
 * Where a bay enters from when it first mounts: its offstage seat on the side
 * it would have come from. Cars slide in laterally — mechanical, not a fade.
 */
export function entryPosition(offset: number): [number, number, number] {
  const side = Math.sign(offset) || 1;
  return [side * 30, 0, -18];
}

export function isOnStage(tier: BayTier): boolean {
  return tier !== "offstage";
}

export { ringOffset };
