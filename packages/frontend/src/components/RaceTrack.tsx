import { useMemo, useRef, useState } from "react";
import {
  AdditiveBlending,
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  Object3D,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from "three";
import type { Group } from "three";
import { useRaceStore } from "../stores/raceStore";
import { TRACK_CONFIG, LANE_WIDTH, getLanePosition } from "../config/trackConfig";

// Re-export config so consumers can import everything from the track module
export { TRACK_CONFIG, LANE_WIDTH, getLanePosition } from "../config/trackConfig";

/**
 * Get world position for a car given its progress (0-1) and lane.
 * The drivable surface top is exactly y = 0.
 */
export function getTrackPosition(progress: number, laneIndex: number): Vector3 {
  const z = progress * TRACK_CONFIG.totalDistance;
  const x = getLanePosition(laneIndex);
  return new Vector3(x, 0, z);
}

/**
 * Get rotation (cars face +Z direction)
 */
export function getTrackRotation(_progress: number): number {
  return 0; // Facing +Z
}

/**
 * Check if position is at a "corner" - the circuit is a straight, so never.
 */
export function isAtCorner(_progress: number): boolean {
  return false;
}

// ============================================
// Track cross-section (derived once)
// ============================================

const HALF_WIDTH = TRACK_CONFIG.trackWidth / 2;
const KERB_INNER = HALF_WIDTH;
const KERB_OUTER = KERB_INNER + TRACK_CONFIG.kerbWidth;
const KERB_CENTER = (KERB_INNER + KERB_OUTER) / 2;
const APRON_INNER = KERB_OUTER;
const APRON_OUTER = APRON_INNER + TRACK_CONFIG.apronWidth;
const APRON_CENTER = (APRON_INNER + APRON_OUTER) / 2;
const WALL_INNER = APRON_OUTER;
const WALL_CENTER = WALL_INNER + TRACK_CONFIG.wallThickness / 2;
const WALL_OUTER = WALL_INNER + TRACK_CONFIG.wallThickness;
const POLE_X = WALL_OUTER + 1.4;
const PYLON_X = WALL_OUTER + 0.7;
const STAND_X = WALL_OUTER + 16;

// Vertical stacking. Only the asphalt sits at exactly y = 0.
const APRON_Y = -0.03;
const GROUND_Y = -0.06;
const DECAL_Y = 0.012;
const LIGHT_POOL_Y = 0.006;

const ASPHALT_BASE = "#1a1a1c";
const CONCRETE = "#2c2c2f";
const ACCENT = TRACK_CONFIG.accent;

// ============================================
// Deterministic noise helpers
// ============================================

function makeRng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap deterministic hash used to vary trackside props per chunk. */
function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Adds one octave of tiling value noise into `field`.
 * The lattice wraps, so the resulting field tiles seamlessly.
 */
function addNoiseOctave(
  field: Float32Array,
  size: number,
  cells: number,
  amplitude: number,
  rng: () => number
): void {
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng();

  const scale = cells / size;
  for (let y = 0; y < size; y++) {
    const fy = y * scale;
    const iy = Math.floor(fy);
    const y0 = iy % cells;
    const y1 = (y0 + 1) % cells;
    const ty = fy - iy;
    const wy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < size; x++) {
      const fx = x * scale;
      const ix = Math.floor(fx);
      const x0 = ix % cells;
      const x1 = (x0 + 1) % cells;
      const tx = fx - ix;
      const wx = tx * tx * (3 - 2 * tx);

      const a = lattice[y0 * cells + x0];
      const b = lattice[y0 * cells + x1];
      const c = lattice[y1 * cells + x0];
      const d = lattice[y1 * cells + x1];
      const top = a + (b - a) * wx;
      const bottom = c + (d - c) * wx;
      field[y * size + x] += (top + (bottom - top) * wy) * amplitude;
    }
  }
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

// ============================================
// Asphalt surface textures
// ============================================

const TEX = TRACK_CONFIG.surfaceTextureSize;
const HEIGHT_TEX = TEX / 2;
const TILE_LENGTH = TRACK_CONFIG.surfaceTileLength;
const SURFACE_REPEAT_Y = TRACK_CONFIG.chunkLength / TILE_LENGTH;

const DASH_PERIOD = TILE_LENGTH / 4; // 6.25 m — divides the tile exactly
const DASH_PAINT = 3.2;
const LANE_LINE_WIDTH = 0.12;
const EDGE_LINE_WIDTH = 0.16;
const EDGE_LINE_X = HALF_WIDTH - 0.4;

/** World X (metres) -> albedo canvas pixel */
const px = (x: number) => ((x + HALF_WIDTH) / TRACK_CONFIG.trackWidth) * TEX;
/** Metres along the tile -> albedo canvas pixel */
const py = (z: number) => (z / TILE_LENGTH) * TEX;

interface SurfaceMaps {
  map: CanvasTexture;
  normalMap: CanvasTexture;
  roughnessMap: CanvasTexture;
}

/** Salt-and-pepper aggregate, shared by every asphalt variant. */
let gritCanvas: HTMLCanvasElement | null = null;
function getGritCanvas(): HTMLCanvasElement {
  if (gritCanvas) return gritCanvas;
  const canvas = createCanvas(TEX, TEX);
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(TEX, TEX);
  const data = image.data;
  const rng = makeRng(9001);
  for (let i = 0; i < TEX * TEX; i++) {
    const v = rng();
    const bright = v > 0.5;
    const strength = Math.abs(v - 0.5) * 2;
    const o = i * 4;
    data[o] = bright ? 255 : 0;
    data[o + 1] = data[o];
    data[o + 2] = data[o];
    data[o + 3] = strength * strength * (bright ? 46 : 62);
  }
  ctx.putImageData(image, 0, 0);
  gritCanvas = canvas;
  return canvas;
}

function paintMarkings(ctx: CanvasRenderingContext2D): void {
  ctx.save();

  // Solid edge lines, inboard of the kerbs
  ctx.fillStyle = "rgba(226, 226, 220, 0.88)";
  const edgeW = px(EDGE_LINE_WIDTH) - px(0);
  for (const sign of [-1, 1]) {
    ctx.fillRect(px(sign * EDGE_LINE_X) - edgeW / 2, 0, edgeW, TEX);
  }

  // Dashed lane dividers
  const laneW = px(LANE_LINE_WIDTH) - px(0);
  const dashH = py(DASH_PAINT);
  ctx.fillStyle = "rgba(222, 222, 216, 0.82)";
  for (let i = 1; i < TRACK_CONFIG.laneCount; i++) {
    const x = -HALF_WIDTH + i * LANE_WIDTH;
    for (let d = 0; d < TILE_LENGTH / DASH_PERIOD; d++) {
      ctx.fillRect(px(x) - laneW / 2, py(d * DASH_PERIOD), laneW, dashH);
    }
  }

  // Wear: knock small holes back out of the fresh paint
  const rng = makeRng(4242);
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.15 + rng() * 0.35})`;
    ctx.fillRect(rng() * TEX, rng() * TEX, 1 + rng() * 3, 1 + rng() * 5);
  }
  ctx.restore();
}

function createSurfaceMaps(seed: number): SurfaceMaps {
  // ── 1. Tiling height field (drives tone, normals and roughness) ──
  const field = new Float32Array(HEIGHT_TEX * HEIGHT_TEX);
  const rng = makeRng(seed);
  addNoiseOctave(field, HEIGHT_TEX, 6, 0.42, rng);
  addNoiseOctave(field, HEIGHT_TEX, 22, 0.26, rng);
  addNoiseOctave(field, HEIGHT_TEX, 90, 0.2, rng);
  addNoiseOctave(field, HEIGHT_TEX, 240, 0.12, rng);

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < field.length; i++) {
    if (field[i] < min) min = field[i];
    if (field[i] > max) max = field[i];
  }
  const span = max - min || 1;
  for (let i = 0; i < field.length; i++) field[i] = (field[i] - min) / span;

  // ── 2. Tonal base from the height field ──
  const toneCanvas = createCanvas(HEIGHT_TEX, HEIGHT_TEX);
  const toneCtx = toneCanvas.getContext("2d")!;
  const toneImage = toneCtx.createImageData(HEIGHT_TEX, HEIGHT_TEX);
  for (let i = 0; i < field.length; i++) {
    const v = 18 + field[i] * 22; // #12 -> #28, dark grey asphalt
    const o = i * 4;
    toneImage.data[o] = v;
    toneImage.data[o + 1] = v;
    toneImage.data[o + 2] = v + 2;
    toneImage.data[o + 3] = 255;
  }
  toneCtx.putImageData(toneImage, 0, 0);

  // ── 3. Albedo ──
  const albedo = createCanvas(TEX, TEX);
  const ctx = albedo.getContext("2d")!;
  ctx.fillStyle = ASPHALT_BASE;
  ctx.fillRect(0, 0, TEX, TEX);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(toneCanvas, 0, 0, TEX, TEX);
  ctx.drawImage(getGritCanvas(), 0, 0);

  // Worn, darker bands along the racing line of every lane
  for (let lane = 0; lane < TRACK_CONFIG.laneCount; lane++) {
    const cx = getLanePosition(lane);
    const bandW = px(2.3) - px(0);
    const gradient = ctx.createLinearGradient(px(cx) - bandW / 2, 0, px(cx) + bandW / 2, 0);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(0.5, "rgba(0,0,0,0.22)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(px(cx) - bandW / 2, 0, bandW, TEX);
  }

  // Paving seams: transverse joints every half tile, plus two longitudinal ones
  ctx.fillStyle = "rgba(0,0,0,0.34)";
  ctx.fillRect(0, py(0) - 1, TEX, 2);
  ctx.fillRect(0, py(TILE_LENGTH / 2) - 1, TEX, 2);
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  for (const x of [-3, 3]) ctx.fillRect(px(x) - 1, 0, 2, TEX);

  paintMarkings(ctx);

  // ── 4. Normal map from the height field ──
  const normalCanvas = createCanvas(HEIGHT_TEX, HEIGHT_TEX);
  const normalCtx = normalCanvas.getContext("2d")!;
  const normalImage = normalCtx.createImageData(HEIGHT_TEX, HEIGHT_TEX);
  const strength = 4.5;
  for (let y = 0; y < HEIGHT_TEX; y++) {
    const up = ((y - 1 + HEIGHT_TEX) % HEIGHT_TEX) * HEIGHT_TEX;
    const down = ((y + 1) % HEIGHT_TEX) * HEIGHT_TEX;
    const row = y * HEIGHT_TEX;
    for (let x = 0; x < HEIGHT_TEX; x++) {
      const left = (x - 1 + HEIGHT_TEX) % HEIGHT_TEX;
      const right = (x + 1) % HEIGHT_TEX;
      const dx = (field[row + left] - field[row + right]) * strength;
      const dy = (field[down + x] - field[up + x]) * strength;
      const len = Math.hypot(dx, dy, 1);
      const o = (row + x) * 4;
      normalImage.data[o] = ((dx / len) * 0.5 + 0.5) * 255;
      normalImage.data[o + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      normalImage.data[o + 2] = (1 / len) * 255;
      normalImage.data[o + 3] = 255;
    }
  }
  normalCtx.putImageData(normalImage, 0, 0);

  // ── 5. Roughness map (asphalt is uniformly rough, slightly polished on peaks) ──
  const roughCanvas = createCanvas(HEIGHT_TEX, HEIGHT_TEX);
  const roughCtx = roughCanvas.getContext("2d")!;
  const roughImage = roughCtx.createImageData(HEIGHT_TEX, HEIGHT_TEX);
  for (let i = 0; i < field.length; i++) {
    const v = 200 + field[i] * 50;
    const o = i * 4;
    roughImage.data[o] = v;
    roughImage.data[o + 1] = v;
    roughImage.data[o + 2] = v;
    roughImage.data[o + 3] = 255;
  }
  roughCtx.putImageData(roughImage, 0, 0);

  const map = new CanvasTexture(albedo);
  map.colorSpace = SRGBColorSpace;
  const normalMap = new CanvasTexture(normalCanvas);
  const roughnessMap = new CanvasTexture(roughCanvas);

  for (const texture of [map, normalMap, roughnessMap]) {
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.repeat.set(1, SURFACE_REPEAT_Y);
    texture.anisotropy = 8;
  }

  return { map, normalMap, roughnessMap };
}

/**
 * Six surface variants share three canvases: clones reuse the same GPU source,
 * so only three textures are ever uploaded. Each variant carries its own
 * V offset (a whole number of dash periods, so markings stay aligned across
 * chunk seams) which breaks up the visible tiling at speed.
 *
 * Created lazily on first render (module scope would break SSR) and kept for
 * the lifetime of the app — the set is small and fixed, and every chunk of
 * every race reuses it.
 */
let surfaceVariants: SurfaceMaps[] | null = null;
function getSurfaceVariant(index: number): SurfaceMaps {
  if (!surfaceVariants) {
    const bases = [createSurfaceMaps(11), createSurfaceMaps(29), createSurfaceMaps(47)];
    surfaceVariants = [];
    for (let i = 0; i < TRACK_CONFIG.surfaceVariants; i++) {
      const base = bases[i % bases.length];
      const offsetV = i < bases.length ? 0 : 0.5;
      if (offsetV === 0) {
        surfaceVariants.push(base);
        continue;
      }
      const clone = (texture: CanvasTexture) => {
        const copy = texture.clone() as CanvasTexture;
        copy.offset.set(0, offsetV);
        copy.needsUpdate = true;
        return copy;
      };
      surfaceVariants.push({
        map: clone(base.map),
        normalMap: clone(base.normalMap),
        roughnessMap: clone(base.roughnessMap),
      });
    }
  }
  return surfaceVariants[index % surfaceVariants.length];
}

// ============================================
// Kerb, apron and light-pool textures
// ============================================

let kerbTexture: CanvasTexture | null = null;
function getKerbTexture(): CanvasTexture {
  if (kerbTexture) return kerbTexture;
  const canvas = createCanvas(64, 256);
  const ctx = canvas.getContext("2d")!;
  // Two red and two white blocks per texture tile
  const block = 64;
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#b8261f" : "#d9d9d2";
    ctx.fillRect(0, i * block, 64, block);
  }
  // Grime and tyre rubber
  const rng = makeRng(77);
  for (let i = 0; i < 2200; i++) {
    const dark = rng() > 0.4;
    ctx.fillStyle = dark
      ? `rgba(0,0,0,${rng() * 0.35})`
      : `rgba(255,255,255,${rng() * 0.14})`;
    ctx.fillRect(rng() * 64, rng() * 256, 1 + rng() * 2, 1 + rng() * 3);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(
    1,
    TRACK_CONFIG.chunkLength / (4 * TRACK_CONFIG.kerbStripeLength)
  );
  texture.anisotropy = 8;
  kerbTexture = texture;
  return texture;
}

let gravelTexture: CanvasTexture | null = null;
function getGravelTexture(): CanvasTexture {
  if (gravelTexture) return gravelTexture;
  const size = 256;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d")!;
  const field = new Float32Array(size * size);
  const rng = makeRng(1337);
  addNoiseOctave(field, size, 8, 0.5, rng);
  addNoiseOctave(field, size, 48, 0.3, rng);
  addNoiseOctave(field, size, 160, 0.2, rng);
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < field.length; i++) {
    const v = 24 + field[i] * 26;
    const o = i * 4;
    image.data[o] = v;
    image.data[o + 1] = v * 0.97;
    image.data[o + 2] = v * 0.9;
    image.data[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  gravelTexture = texture;
  return texture;
}

let lightPoolTexture: CanvasTexture | null = null;
function getLightPoolTexture(): CanvasTexture {
  if (lightPoolTexture) return lightPoolTexture;
  const size = 256;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
  gradient.addColorStop(0, "rgba(206, 219, 234, 0.85)");
  gradient.addColorStop(0.35, "rgba(180, 196, 214, 0.32)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  lightPoolTexture = texture;
  return texture;
}

// ============================================
// Painted floor decals (start grid, finish board, marker boards)
// ============================================

/**
 * Ground decals are drawn in world space (canvas top = -Z, canvas left = -X).
 * Text has to be rotated 180 degrees to read correctly from a chase camera
 * sitting behind the cars and looking down +Z.
 */
function drawGroundText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  fill: string
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI);
  ctx.font = font;
  ctx.fillStyle = fill;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function makeDecalTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.minFilter = LinearFilter;
  texture.anisotropy = 8;
  return texture;
}

const GRID_AREA_Z_MIN = -TRACK_CONFIG.gridAreaLength + 2;
const GRID_AREA_Z_MAX = 2;

let startDecalTexture: CanvasTexture | null = null;
function getStartDecalTexture(): CanvasTexture {
  if (startDecalTexture) return startDecalTexture;
  const w = 1024;
  const h = 1024;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  const dx = (x: number) => ((x + HALF_WIDTH) / TRACK_CONFIG.trackWidth) * w;
  const dz = (z: number) =>
    ((z - GRID_AREA_Z_MIN) / TRACK_CONFIG.gridAreaLength) * h;
  const mx = (m: number) => (m / TRACK_CONFIG.trackWidth) * w;
  const mz = (m: number) => (m / TRACK_CONFIG.gridAreaLength) * h;

  const paint = "rgba(228, 228, 222, 0.92)";

  // Solid start line across the full track
  ctx.fillStyle = paint;
  ctx.fillRect(dx(-HALF_WIDTH), dz(-0.25), mx(TRACK_CONFIG.trackWidth), mz(0.5));

  // Grid boxes, one per lane
  const boxFront = -1.6;
  const boxBack = boxFront - TRACK_CONFIG.gridBoxLength;
  const lineW = mx(0.12);
  for (let lane = 0; lane < TRACK_CONFIG.laneCount; lane++) {
    const cx = getLanePosition(lane);
    const left = cx - TRACK_CONFIG.gridBoxWidth / 2;

    ctx.strokeStyle = paint;
    ctx.lineWidth = lineW;
    ctx.strokeRect(
      dx(left),
      dz(boxBack),
      mx(TRACK_CONFIG.gridBoxWidth),
      mz(TRACK_CONFIG.gridBoxLength)
    );

    // Filled staging bar at the front of the box
    ctx.fillStyle = paint;
    ctx.fillRect(
      dx(left),
      dz(boxFront - 0.55),
      mx(TRACK_CONFIG.gridBoxWidth),
      mz(0.45)
    );

    drawGroundText(
      ctx,
      `${lane + 1}`,
      dx(cx),
      dz(boxBack - 1.6),
      `700 ${Math.round(mz(1.9))}px 'JetBrains Mono', monospace`,
      "rgba(210, 210, 205, 0.8)"
    );
  }

  // Technical hatch bands along the outer edges of the grid area
  ctx.fillStyle = "rgba(200, 200, 195, 0.35)";
  for (const sign of [-1, 1]) {
    for (let z = boxBack; z < boxFront; z += 1.1) {
      ctx.fillRect(dx(sign * (HALF_WIDTH - 1.4)) - mx(0.5), dz(z), mx(1), mz(0.5));
    }
  }

  startDecalTexture = makeDecalTexture(canvas);
  return startDecalTexture;
}

let finishDecalTexture: CanvasTexture | null = null;
function getFinishDecalTexture(): CanvasTexture {
  if (finishDecalTexture) return finishDecalTexture;
  const w = 1024;
  const h = 256;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d")!;

  const columns = 12;
  const rows = 3;
  const cw = w / columns;
  const band = (h * 0.78) / rows;
  const top = (h - band * rows) / 2;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? "rgba(232,232,226,0.94)" : "rgba(12,12,14,0.94)";
      ctx.fillRect(c * cw, top + r * band, cw + 1, band + 1);
    }
  }

  // Solid paint edges above and below the checker
  ctx.fillStyle = "rgba(228,228,222,0.9)";
  ctx.fillRect(0, top - h * 0.05, w, h * 0.035);
  ctx.fillRect(0, top + band * rows + h * 0.015, w, h * 0.035);

  // Wear
  const rng = makeRng(555);
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.1 + rng() * 0.3})`;
    ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 4, 1 + rng() * 3);
  }
  ctx.globalCompositeOperation = "source-over";

  finishDecalTexture = makeDecalTexture(canvas);
  return finishDecalTexture;
}

const markerBoardCache = new Map<number, CanvasTexture>();
function getMarkerBoardTexture(remaining: number): CanvasTexture {
  const cached = markerBoardCache.get(remaining);
  if (cached) return cached;
  const w = 512;
  const h = 256;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0d0d0f";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#2a2a2a";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 132px 'JetBrains Mono', monospace";
  ctx.fillText(`${remaining}`, w / 2, h / 2 - 16);
  ctx.font = "500 34px 'JetBrains Mono', monospace";
  ctx.fillStyle = "#bfbfbf";
  ctx.letterSpacing = "6px";
  ctx.fillText("METRES TO GO", w / 2, h - 52);

  const texture = makeDecalTexture(canvas);
  markerBoardCache.set(remaining, texture);
  return texture;
}

// ============================================
// Track Chunk
// ============================================

function TrackChunk({ chunkIndex, showBarriers }: { chunkIndex: number; showBarriers: boolean }) {
  const chunkZ = chunkIndex * TRACK_CONFIG.chunkLength + TRACK_CONFIG.chunkLength / 2;
  const surface = getSurfaceVariant(chunkIndex);
  const kerb = getKerbTexture();
  const gravel = useMemo(() => {
    const texture = getGravelTexture().clone();
    texture.repeat.set(TRACK_CONFIG.apronWidth / 4, TRACK_CONFIG.chunkLength / 4);
    texture.needsUpdate = true;
    return texture;
  }, []);

  // One light pole per chunk, alternating sides
  const poleSide = chunkIndex % 2 === 0 ? -1 : 1;
  const standSide = -poleSide;
  const standHeight = 5 + hash01(chunkIndex) * 5;
  const standLength = TRACK_CONFIG.chunkLength * 0.82;

  return (
    <group position={[0, 0, chunkZ]}>
      {/* Asphalt — top surface is exactly y = 0, markings are baked in */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[TRACK_CONFIG.trackWidth, TRACK_CONFIG.chunkLength]} />
        <meshStandardMaterial
          map={surface.map}
          normalMap={surface.normalMap}
          normalScale={[0.85, 0.85]}
          roughnessMap={surface.roughnessMap}
          roughness={1}
          metalness={0.02}
          envMapIntensity={0.35}
          color="#ffffff"
        />
      </mesh>

      {showBarriers && (
        <>
          {[-1, 1].map((side) => (
            <group key={`edge-${side}`}>
              {/* Kerb body — raised geometry so it catches light and shadow */}
              <mesh
                position={[
                  side * KERB_CENTER,
                  TRACK_CONFIG.kerbHeight / 2 - 0.05,
                  0,
                ]}
                castShadow
                receiveShadow
              >
                <boxGeometry
                  args={[
                    TRACK_CONFIG.kerbWidth,
                    TRACK_CONFIG.kerbHeight + 0.1,
                    TRACK_CONFIG.chunkLength,
                  ]}
                />
                <meshStandardMaterial color="#6a6a6c" roughness={0.85} metalness={0.02} />
              </mesh>
              {/* Kerb stripes */}
              <mesh
                position={[side * KERB_CENTER, TRACK_CONFIG.kerbHeight, 0]}
                rotation={[-Math.PI / 2, 0, 0]}
                receiveShadow
              >
                <planeGeometry args={[TRACK_CONFIG.kerbWidth, TRACK_CONFIG.chunkLength]} />
                <meshStandardMaterial map={kerb} roughness={0.75} metalness={0.02} />
              </mesh>

              {/* Run-off apron */}
              <mesh
                position={[side * APRON_CENTER, APRON_Y, 0]}
                rotation={[-Math.PI / 2, 0, 0]}
                receiveShadow
              >
                <planeGeometry args={[TRACK_CONFIG.apronWidth, TRACK_CONFIG.chunkLength]} />
                <meshStandardMaterial map={gravel} roughness={1} metalness={0} />
              </mesh>

              {/* Concrete barrier wall */}
              <mesh
                position={[side * WALL_CENTER, TRACK_CONFIG.wallHeight / 2, 0]}
                castShadow
                receiveShadow
              >
                <boxGeometry
                  args={[
                    TRACK_CONFIG.wallThickness,
                    TRACK_CONFIG.wallHeight,
                    TRACK_CONFIG.chunkLength,
                  ]}
                />
                <meshStandardMaterial color={CONCRETE} roughness={0.95} metalness={0.02} />
              </mesh>

              {/* Single brand accent: a light strip along the wall top */}
              <mesh
                position={[
                  side * (WALL_INNER + 0.12),
                  TRACK_CONFIG.wallHeight + 0.02,
                  0,
                ]}
              >
                <boxGeometry args={[0.16, 0.05, TRACK_CONFIG.chunkLength - 0.6]} />
                {/* This strip runs the whole length of the circuit and passes
                    within metres of the low camera rigs. Unlike the gantries,
                    which are point features seen at a distance, it stays tone
                    mapped so ACES rolls the highlight off up close — untone-
                    mapped it blooms into a neon bar that owns the frame, which
                    is the Tron look the accent policy exists to avoid. */}
                <meshStandardMaterial
                  color={ACCENT}
                  emissive={ACCENT}
                  emissiveIntensity={0.55}
                />
              </mesh>
            </group>
          ))}

          {/* Light pole with a baked pool of light on the surface */}
          <group position={[poleSide * POLE_X, 0, 0]}>
            <mesh position={[0, TRACK_CONFIG.poleHeight / 2, 0]} castShadow>
              <boxGeometry args={[0.22, TRACK_CONFIG.poleHeight, 0.22]} />
              <meshStandardMaterial color="#1c1c1f" roughness={0.6} metalness={0.5} />
            </mesh>
            <mesh
              position={[-poleSide * 0.9, TRACK_CONFIG.poleHeight - 0.25, 0]}
              castShadow
            >
              <boxGeometry args={[1.8, 0.16, 0.16]} />
              <meshStandardMaterial color="#1c1c1f" roughness={0.6} metalness={0.5} />
            </mesh>
            <mesh position={[-poleSide * 1.7, TRACK_CONFIG.poleHeight - 0.45, 0]}>
              <boxGeometry args={[1.1, 0.16, 0.5]} />
              <meshStandardMaterial
                color="#c9d4e0"
                emissive="#c9d4e0"
                emissiveIntensity={1.6}
                toneMapped={false}
              />
            </mesh>
          </group>
          <mesh
            position={[poleSide * (HALF_WIDTH - 1), LIGHT_POOL_Y, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[26, 26]} />
            <meshBasicMaterial
              map={getLightPoolTexture()}
              transparent
              opacity={0.16}
              depthWrite={false}
              blending={AdditiveBlending}
              toneMapped={false}
            />
          </mesh>

          {/* Distant grandstand silhouette */}
          <mesh
            position={[standSide * STAND_X, standHeight / 2, 0]}
            castShadow={false}
            receiveShadow={false}
          >
            <boxGeometry args={[10, standHeight, standLength]} />
            <meshStandardMaterial color="#0b0b0f" roughness={1} metalness={0} />
          </mesh>
        </>
      )}
    </group>
  );
}

// ============================================
// Gantry (shared by start and finish)
// ============================================

function Gantry({ height, withLights }: { height: number; withLights: boolean }) {
  const span = PYLON_X * 2 + 1.2;
  return (
    <group>
      {[-1, 1].map((side) => (
        <mesh key={`pylon-${side}`} position={[side * PYLON_X, height / 2, 0]} castShadow>
          <boxGeometry args={[0.55, height, 0.55]} />
          <meshStandardMaterial color="#171719" roughness={0.55} metalness={0.6} />
        </mesh>
      ))}

      {/* Truss chords */}
      <mesh position={[0, height - 0.35, 0]} castShadow>
        <boxGeometry args={[span, 0.28, 0.5]} />
        <meshStandardMaterial color="#171719" roughness={0.55} metalness={0.6} />
      </mesh>
      <mesh position={[0, height + 0.85, 0]} castShadow>
        <boxGeometry args={[span, 0.28, 0.5]} />
        <meshStandardMaterial color="#171719" roughness={0.55} metalness={0.6} />
      </mesh>

      {/* Truss diagonals */}
      {Array.from({ length: 8 }).map((_, i) => (
        <mesh
          key={`diag-${i}`}
          position={[(i - 3.5) * (span / 8), height + 0.25, 0]}
          rotation={[0, 0, i % 2 === 0 ? 0.75 : -0.75]}
          castShadow
        >
          <boxGeometry args={[0.12, 1.7, 0.24]} />
          <meshStandardMaterial color="#171719" roughness={0.55} metalness={0.6} />
        </mesh>
      ))}

      {/* Single accent strip on the leading face */}
      <mesh position={[0, height - 0.58, -0.24]}>
        <boxGeometry args={[span - 1.2, 0.06, 0.06]} />
        <meshStandardMaterial
          color={ACCENT}
          emissive={ACCENT}
          emissiveIntensity={2.6}
          toneMapped={false}
        />
      </mesh>

      {/* Unlit start-light housings — the countdown itself lives in the HUD */}
      {withLights &&
        Array.from({ length: 5 }).map((_, i) => (
          <mesh key={`housing-${i}`} position={[(i - 2) * 2.4, height - 1.5, -0.2]} castShadow>
            <boxGeometry args={[1.5, 1.5, 0.45]} />
            <meshStandardMaterial color="#0e0e10" roughness={0.5} metalness={0.4} />
          </mesh>
        ))}
    </group>
  );
}

// ============================================
// Start Line
// ============================================

function StartLine() {
  return (
    <group position={[0, 0, 0]}>
      {/* Painted starting grid */}
      <mesh
        position={[0, DECAL_Y, (GRID_AREA_Z_MIN + GRID_AREA_Z_MAX) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[TRACK_CONFIG.trackWidth, TRACK_CONFIG.gridAreaLength]} />
        <meshStandardMaterial
          map={getStartDecalTexture()}
          transparent
          depthWrite={false}
          roughness={0.6}
          metalness={0}
          polygonOffset
          polygonOffsetFactor={-4}
          polygonOffsetUnits={-4}
        />
      </mesh>

      <Gantry height={8.5} withLights />

      {/* Only real light at the start: the gantry floods the grid */}
      <pointLight position={[0, 7.5, 4]} intensity={30} distance={34} decay={2} color="#c8d6e6" />
    </group>
  );
}

// ============================================
// Finish Line
// ============================================

function FinishLine() {
  return (
    <group position={[0, 0, TRACK_CONFIG.totalDistance]}>
      {/* Painted checkered board */}
      <mesh position={[0, DECAL_Y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[TRACK_CONFIG.trackWidth, TRACK_CONFIG.finishBoardLength]} />
        <meshStandardMaterial
          map={getFinishDecalTexture()}
          transparent
          depthWrite={false}
          roughness={0.6}
          metalness={0}
          polygonOffset
          polygonOffsetFactor={-4}
          polygonOffsetUnits={-4}
        />
      </mesh>

      <Gantry height={9.5} withLights={false} />

      <pointLight position={[0, 8.5, -4]} intensity={34} distance={38} decay={2} color="#c8d6e6" />
    </group>
  );
}

// ============================================
// Distance boards (no real lights — emissive-free signage)
// ============================================

function DistanceMarkers({ leadCarZ }: { leadCarZ: number }) {
  const markers = useMemo(() => {
    const result: number[] = [];
    for (
      let z = TRACK_CONFIG.markerSpacing;
      z < TRACK_CONFIG.totalDistance;
      z += TRACK_CONFIG.markerSpacing
    ) {
      result.push(z);
    }
    return result;
  }, []);

  const ahead = TRACK_CONFIG.chunkLength * TRACK_CONFIG.visibleChunks;
  const visible = markers.filter(
    (z) => z >= leadCarZ - TRACK_CONFIG.chunkLength && z <= leadCarZ + ahead
  );

  return (
    <>
      {visible.map((z) => (
        <group key={`marker-${z}`} position={[0, 0, z]}>
          {/* Transverse sector line painted across the asphalt */}
          <mesh position={[0, DECAL_Y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[TRACK_CONFIG.trackWidth, 0.28]} />
            <meshStandardMaterial
              color="#dcdcd6"
              roughness={0.65}
              metalness={0}
              transparent
              opacity={0.75}
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={-4}
              polygonOffsetUnits={-4}
            />
          </mesh>

          {/* Board on top of the left wall, facing oncoming cars */}
          <mesh
            position={[-(WALL_CENTER), TRACK_CONFIG.wallHeight + 0.62, 0]}
            rotation={[0, Math.PI, 0]}
          >
            <planeGeometry args={[2, 1]} />
            <meshStandardMaterial
              map={getMarkerBoardTexture(TRACK_CONFIG.totalDistance - z)}
              roughness={0.8}
              metalness={0}
            />
          </mesh>
          <mesh position={[-(WALL_CENTER), TRACK_CONFIG.wallHeight + 0.3, 0.06]} castShadow>
            <boxGeometry args={[0.1, 0.6, 0.1]} />
            <meshStandardMaterial color="#151517" roughness={0.6} metalness={0.5} />
          </mesh>
        </group>
      ))}
    </>
  );
}

// ============================================
// Main RaceTrack Component
// ============================================

interface RaceTrackProps {
  /** Render the streamed asphalt chunks. */
  showPath?: boolean;
  /** Render kerbs, barriers and the trackside environment. */
  showBarriers?: boolean;
}

export function RaceTrack({ showPath = true, showBarriers = true }: RaceTrackProps) {
  const trackGroupRef = useRef<Group>(null);
  const participants = useRaceStore((state) => state.participants);

  // The shadow-casting light needs an explicit target that travels with the
  // pack, otherwise its frustum stays parked at the world origin and the cars
  // stop casting shadows a few seconds into the race.
  const [sunTarget] = useState(() => new Object3D());

  const leadCarZ = useMemo(() => {
    if (participants.length === 0) return 0;
    const leader = participants.reduce((prev, curr) =>
      curr.progress > prev.progress ? curr : prev
    );
    return leader.progress * TRACK_CONFIG.totalDistance;
  }, [participants]);

  // Centre the shadow frustum slightly behind the leader so the whole pack fits
  const focusZ = leadCarZ - 20;

  const visibleChunks = useMemo(() => {
    const currentChunk = Math.floor(leadCarZ / TRACK_CONFIG.chunkLength);
    const chunks: number[] = [];

    const startChunk = Math.max(0, currentChunk - TRACK_CONFIG.behindChunks);
    const endChunk = Math.min(
      Math.ceil(TRACK_CONFIG.totalDistance / TRACK_CONFIG.chunkLength),
      currentChunk + TRACK_CONFIG.visibleChunks
    );

    for (let i = startChunk; i <= endChunk; i++) chunks.push(i);
    return chunks;
  }, [leadCarZ]);

  const groundTexture = useMemo(() => {
    const texture = getGravelTexture().clone();
    texture.repeat.set(40, TRACK_CONFIG.totalDistance / 10);
    texture.needsUpdate = true;
    return texture;
  }, []);

  const nearStart = leadCarZ < TRACK_CONFIG.chunkLength * TRACK_CONFIG.visibleChunks;
  const nearFinish =
    leadCarZ >
    TRACK_CONFIG.totalDistance - TRACK_CONFIG.chunkLength * TRACK_CONFIG.visibleChunks;

  return (
    <group ref={trackGroupRef}>
      {/* Ground beyond the circuit — keeps the track from floating in a void */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, GROUND_Y, TRACK_CONFIG.totalDistance / 2]}
        receiveShadow
      >
        <planeGeometry args={[400, TRACK_CONFIG.totalDistance + 400]} />
        <meshStandardMaterial map={groundTexture} color="#4a4a48" roughness={1} metalness={0} />
      </mesh>

      {/* Streaming track chunks */}
      {showPath &&
        visibleChunks.map((chunkIndex) => (
          <TrackChunk
            key={`chunk-${chunkIndex}`}
            chunkIndex={chunkIndex}
            showBarriers={showBarriers}
          />
        ))}

      {nearStart && <StartLine />}
      {nearFinish && <FinishLine />}

      {showBarriers && <DistanceMarkers leadCarZ={leadCarZ} />}

      {/* ── Light budget: 1 ambient + 1 hemisphere + 1 directional (shadows)
             + at most 1 point light (start OR finish gantry). Everything else
             trackside is emissive geometry or a baked light pool. ── */}
      <ambientLight intensity={0.18} color="#93a4bd" />
      <hemisphereLight args={["#1d2836", "#050508", 0.45]} />
      <primitive object={sunTarget} position={[0, 0, focusZ]} />
      <directionalLight
        position={[-38, 52, focusZ - 30]}
        target={sunTarget}
        intensity={0.9}
        color="#aebdd8"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={5}
        shadow-camera-far={170}
        shadow-camera-left={-70}
        shadow-camera-right={70}
        shadow-camera-top={70}
        shadow-camera-bottom={-70}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
    </group>
  );
}

export default RaceTrack;
