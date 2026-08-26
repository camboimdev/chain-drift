/**
 * Chain Drift — procedural car part generator.
 *
 * Run: node scripts/generate-parts.mjs
 *
 * Outputs OBJ files to public/parts/:
 *
 *  SPOILERS
 *    Car_Spoiler_GTWing.obj        — tall twin-stanchion racing wing
 *    Car_Spoiler_Ducktail.obj      — curved deck-lid lip
 *    Car_Spoiler_LipSpoiler.obj    — subtle flush rear lip
 *    Car_Spoiler_WidebodyWing.obj  — wide competition wing beyond car edges
 *
 *  EXHAUSTS  (position: rear of car, Y≈0.28, Z≈-2.30)
 *    Car_Exhaust_Single.obj        — single large center tip
 *    Car_Exhaust_Dual.obj          — twin side-mounted tips
 *    Car_Exhaust_Quad.obj          — four-tip race exhaust
 *
 *  FRONT SPLITTERS  (position: front of car, Y≈0.05–0.15, Z≈+2.20)
 *    Car_Splitter_Lip.obj          — subtle front lip
 *    Car_Splitter_Track.obj        — aggressive flat diffuser plate
 *    Car_Splitter_Wide.obj         — widebody splitter extending past fenders
 *
 *  WHEELS (additional rim styles)
 *    Car_Wheels_Monoblock.obj      — solid face with milled pockets
 *    Car_Wheels_YSpoke.obj         — split / Y-shaped 5 spokes
 *    Car_Wheels_TriSpoke.obj       — 3 wide-blade spokes
 *    Car_Wheels_DeepDish.obj       — wide barrel, small recessed face
 */

import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT   = join(__dir, "../public/parts");

const PI2 = Math.PI * 2;

// ── Generic OBJ builder ───────────────────────────────────────────────────────
class OBJBuilder {
  constructor(name) {
    this.name  = name;
    this.verts = [];
    this.faces = [];
  }

  v(x, y, z) {
    this.verts.push([x, y, z]);
    return this.verts.length; // 1-indexed
  }

  f(...ids) { this.faces.push(ids); }

  /** Ring of N vertices in YZ plane at given X — for wheel rims (axis = X). */
  ring(x, cy, cz, r, n = 16) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (PI2 * i) / n;
      out.push(this.v(x, cy + r * Math.cos(a), cz + r * Math.sin(a)));
    }
    return out;
  }

  /** Ring of N vertices in XY plane at given Z — for exhaust/intake pipes (axis = Z). */
  ringXY(cx, cy, cz, r, n = 16) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (PI2 * i) / n;
      out.push(this.v(cx + r * Math.cos(a), cy + r * Math.sin(a), cz));
    }
    return out;
  }

  /** Quads connecting ring A to ring B (same length). */
  barrel(a, b, flip = false) {
    const n = a.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (flip) this.f(a[i], b[i], b[j], a[j]);
      else      this.f(a[i], a[j], b[j], b[i]);
    }
  }

  /** Fan of tris from center vertex to a ring. */
  cap(cv, ring, flip = false) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (flip) this.f(cv, ring[j], ring[i]);
      else      this.f(cv, ring[i], ring[j]);
    }
  }

  /** Flat quad (4 vertices). */
  quad(a, b, c, d) { this.f(a, b, c, d); }

  /** Box: 8 vertices defined by min/max, returns { verts, faces } as ids. */
  box(x0, x1, y0, y1, z0, z1) {
    const v000 = this.v(x0, y0, z0);
    const v100 = this.v(x1, y0, z0);
    const v110 = this.v(x1, y1, z0);
    const v010 = this.v(x0, y1, z0);
    const v001 = this.v(x0, y0, z1);
    const v101 = this.v(x1, y0, z1);
    const v111 = this.v(x1, y1, z1);
    const v011 = this.v(x0, y1, z1);
    // 6 faces
    this.f(v000, v100, v110, v010); // front (z0)
    this.f(v001, v011, v111, v101); // back (z1)
    this.f(v000, v001, v101, v100); // bottom
    this.f(v010, v110, v111, v011); // top
    this.f(v000, v010, v011, v001); // left
    this.f(v100, v101, v111, v110); // right
  }

  toString() {
    const ls = [`# Chain Drift — ${this.name}`, `# generate-parts.mjs`, `o ${this.name.replace(/\s/g, "_")}`];
    for (const [x, y, z] of this.verts) ls.push(`v ${x.toFixed(5)} ${y.toFixed(5)} ${z.toFixed(5)}`);
    for (const f of this.faces) ls.push(`f ${f.join(" ")}`);
    return ls.join("\n") + "\n";
  }

  write(filename) {
    const content = this.toString();
    writeFileSync(join(OUT, filename), content);
    const nv = this.verts.length, nf = this.faces.length;
    console.log(`  ✓ ${filename.padEnd(38)} ${nv} verts, ${nf} faces`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SPOILERS
// Camera is at Z=+25, so +Z = front, -Z = rear.
// Rear deck: X≈0.007, Z≈-2.0 to -2.25 (rear), trunk top Y≈0.97 at Z≈-2.0
// ══════════════════════════════════════════════════════════════════════════════

/** Airfoil cross-section profile (chord along Z, lift direction Y).
 *  Returns array of [dz, dy] pairs for N points on the NACA-style profile.
 *  chord = total Z length, maxThickness applied at ~30% chord.
 */
function airfoilProfile(chord, thickness, n = 12) {
  const pts = [];
  // Upper surface (forward to rear)
  for (let i = 0; i <= n; i++) {
    const t  = i / n;                             // 0..1 along chord
    const dz = -chord / 2 + t * chord;           // Z offset from center
    const dy = thickness * (0.6 * Math.sin(Math.PI * t) + 0.15 * Math.sin(2 * Math.PI * t));
    pts.push([dz, dy]);
  }
  // Lower surface (rear to forward)
  for (let i = n - 1; i >= 1; i--) {
    const t  = i / n;
    const dz = -chord / 2 + t * chord;
    const dy = -thickness * 0.12 * Math.sin(Math.PI * t); // slight camber on bottom
    pts.push([dz, dy]);
  }
  return pts; // closed loop
}

/** Extrude a 2D profile ([dz,dy] pairs) along X from x0 to x1. */
function extrudeProfile(b, profile, cx, cy, x0, x1) {
  const n = profile.length;
  const front = profile.map(([dz, dy]) => b.v(x0, cy + dy, cx + dz));
  const back  = profile.map(([dz, dy]) => b.v(x1, cy + dy, cx + dz));
  // Side faces
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    b.f(front[i], front[j], back[j], back[i]);
  }
  // End caps
  const fc = b.v((x0 + x1) / 2, cy, cx); // approx center for cap
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    b.f(fc, front[j], front[i]);
    b.f(fc, back[i], back[j]);
  }
}

function buildGTWing() {
  const b = new OBJBuilder("GT_Wing");
  const CX = 0.007;  // car center X offset
  const CY = 1.21;   // wing height (trunk top at rear)
  const CZ = -2.05;  // rear deck (negative Z = rear)

  const SPAN      = 0.80; // half-span from center to tip
  const CHORD     = 0.28;
  const THICKNESS = 0.06;

  // Main wing element
  const profile = airfoilProfile(CHORD, THICKNESS);
  extrudeProfile(b, profile, CZ, CY, CX - SPAN, CX + SPAN);

  // End plates (rectangular vertical fins at each tip)
  const EP_H = 0.12, EP_D = 0.22, EP_W = 0.02;
  for (const side of [-1, 1]) {
    const ex = CX + side * (SPAN + EP_W / 2);
    b.box(ex - EP_W, ex + EP_W, CY - EP_H / 2, CY + EP_H / 2, CZ - EP_D / 2, CZ + EP_D / 2);
  }

  // Stanchions (two vertical posts supporting the wing)
  const POST_H = 0.24, POST_W = 0.04, POST_D = 0.04;
  for (const side of [-1, 1]) {
    const px = CX + side * SPAN * 0.55;
    b.box(px - POST_W / 2, px + POST_W / 2, CY - POST_H, CY, CZ - POST_D / 2, CZ + POST_D / 2);
  }

  b.write("Car_Spoiler_GTWing.obj");
}

function buildDucktail() {
  const b = new OBJBuilder("Ducktail");
  const CX = 0.007;
  const CY = 0.95;  // deck lid height at rear
  const CZ = -2.20; // very rear of trunk (negative Z = rear)

  const SPAN      = 0.72;
  const CHORD     = 0.18;
  const THICKNESS = 0.04;

  const profile = airfoilProfile(CHORD, THICKNESS, 10);
  extrudeProfile(b, profile, CZ, CY, CX - SPAN, CX + SPAN);

  b.write("Car_Spoiler_Ducktail.obj");
}

function buildLipSpoiler() {
  const b = new OBJBuilder("Lip_Spoiler");
  const CX = 0.007;
  // Thin strip sitting on rear edge — very subtle
  const Y  = 0.97, Z = -2.22; // rear of car (negative Z)
  const HW = 0.68; // half-width
  // Flat lip: thin box extending rearward from Z
  b.box(CX - HW, CX + HW, Y, Y + 0.06, Z - 0.08, Z);
  b.write("Car_Spoiler_LipSpoiler.obj");
}

function buildWidebodyWing() {
  const b = new OBJBuilder("Widebody_Wing");
  const CX = 0.007;
  const CY = 1.24;
  const CZ = -2.00; // rear (negative Z)

  const SPAN      = 1.05; // extends past car edges (car half-width ~1.05)
  const CHORD     = 0.32;
  const THICKNESS = 0.07;

  const profile = airfoilProfile(CHORD, THICKNESS);
  extrudeProfile(b, profile, CZ, CY, CX - SPAN, CX + SPAN);

  // Larger end plates
  const EP_H = 0.18, EP_D = 0.28, EP_W = 0.025;
  for (const side of [-1, 1]) {
    const ex = CX + side * (SPAN + EP_W / 2);
    b.box(ex - EP_W, ex + EP_W, CY - EP_H / 2, CY + EP_H / 2, CZ - EP_D / 2, CZ + EP_D / 2);
  }

  // 3 stanchions
  const POST_H = 0.28, POST_W = 0.045, POST_D = 0.045;
  for (const side of [-1, 0, 1]) {
    const px = CX + side * SPAN * 0.5;
    b.box(px - POST_W / 2, px + POST_W / 2, CY - POST_H, CY, CZ - POST_D / 2, CZ + POST_D / 2);
  }

  b.write("Car_Spoiler_WidebodyWing.obj");
}

// ══════════════════════════════════════════════════════════════════════════════
// EXHAUSTS
// Rear of car: Z≈-2.26 to -2.35 (negative Z = rear), Y≈0.28, X varies
// Pipes run along Z axis → use ringXY (XY-plane circles at given Z).
// cz = tip Z (most negative), len > 0 extends toward front of car.
// ══════════════════════════════════════════════════════════════════════════════

function buildExhaustPipe(b, cx, cy, cz, outerR, innerR, len, segs = 16) {
  // Tip rings at rear (cz), base rings inside car body (cz + len)
  const oTip  = b.ringXY(cx, cy, cz,       outerR, segs);
  const oBase = b.ringXY(cx, cy, cz + len, outerR, segs);
  b.barrel(oBase, oTip);

  const iTip  = b.ringXY(cx, cy, cz,       innerR, segs);
  const iBase = b.ringXY(cx, cy, cz + len, innerR, segs);
  b.barrel(iTip, iBase, true);

  // Visible tip annulus (rear-facing end)
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    b.f(oTip[i], iTip[i], iTip[j], oTip[j]);
  }

  // Base annulus (capped inside body)
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    b.f(oBase[i], oBase[j], iBase[j], iBase[i]);
  }

  // Flare: slightly wider ring just past the tip
  const flareR = outerR * 1.15;
  const flareW = 0.015;
  const fRing  = b.ringXY(cx, cy, cz - flareW, flareR, segs);
  b.barrel(oTip, fRing);
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    b.f(fRing[i], fRing[j], iTip[j], iTip[i]);
  }
}

function buildExhaustSingle() {
  const b = new OBJBuilder("Exhaust_Single");
  // cz=-2.32: tip protrudes ~4.5cm past rear bumper face at Z=-2.275
  buildExhaustPipe(b, 0.007, 0.30, -2.32, 0.065, 0.048, 0.12);
  b.write("Car_Exhaust_Single.obj");
}

function buildExhaustDual() {
  const b = new OBJBuilder("Exhaust_Dual");
  buildExhaustPipe(b, -0.32, 0.28, -2.32, 0.052, 0.038, 0.11);
  buildExhaustPipe(b,  0.33, 0.28, -2.32, 0.052, 0.038, 0.11);
  b.write("Car_Exhaust_Dual.obj");
}

function buildExhaustQuad() {
  const b = new OBJBuilder("Exhaust_Quad");
  for (const [dx, dy] of [[-0.38, 0.06], [-0.22, 0.06], [0.23, 0.06], [0.39, 0.06]]) {
    buildExhaustPipe(b, dx, 0.27 + dy, -2.32, 0.040, 0.029, 0.11);
  }
  b.write("Car_Exhaust_Quad.obj");
}

// ══════════════════════════════════════════════════════════════════════════════
// FRONT SPLITTERS
// Front bumper bottom confirmed at Y=0.30 (Z>2.0, same as rear).
// All splitters must connect at Y≈0.30 — plate from Y=0.22 to Y=0.32,
// fins/canards hang below (Y=0.07 to 0.22) like a real front apron.
// Front bumper face at Z≈2.225; protrude forward to Z≈2.38.
// ══════════════════════════════════════════════════════════════════════════════

function buildSplitterLip() {
  const b = new OBJBuilder("Splitter_Lip");
  const CX = 0.007;
  const HW = 0.85;
  const Z0 = 2.00, Z1 = 2.38;

  // Thin shelf plate at bumper bottom (Y=0.30)
  b.box(CX - HW, CX + HW, 0.24, 0.32, Z0, Z1);

  // Subtle front lip hanging below
  b.box(CX - HW, CX + HW, 0.14, 0.24, Z1 - 0.04, Z1);

  b.write("Car_Splitter_Lip.obj");
}

function buildSplitterTrack() {
  const b = new OBJBuilder("Splitter_Track");
  const CX = 0.007;
  const HW = 0.95;
  const Z0 = 2.00, Z1 = 2.38;

  // Main shelf plate at bumper bottom
  b.box(CX - HW, CX + HW, 0.22, 0.30, Z0, Z1);

  // Side canards — vertical fins rising above the plate
  const FIN_H = 0.12, FIN_W = 0.025, FIN_D = 0.18;
  for (const side of [-1, 1]) {
    const fx = CX + side * (HW - FIN_W);
    b.box(fx - FIN_W / 2, fx + FIN_W / 2, 0.30, 0.30 + FIN_H, Z1 - FIN_D, Z1);
  }

  // Front lip — thin vertical front edge hanging below plate
  b.box(CX - HW, CX + HW, 0.10, 0.30, Z1 - 0.025, Z1);

  b.write("Car_Splitter_Track.obj");
}

function buildSplitterWide() {
  const b = new OBJBuilder("Splitter_Wide");
  const CX = 0.007;
  const HW = 1.10; // extends beyond stock fender line
  const Z0 = 2.00, Z1 = 2.38;

  // Main shelf plate at bumper bottom
  b.box(CX - HW, CX + HW, 0.22, 0.30, Z0, Z1);

  // Outer vertical end fences rising above plate
  for (const side of [-1, 1]) {
    const fx = CX + side * HW;
    b.box(fx - 0.02, fx + 0.02, 0.30, 0.46, Z0 + 0.05, Z1 - 0.03);
  }

  // Front apron — tall front edge hanging below plate
  b.box(CX - HW, CX + HW, 0.07, 0.30, Z1 - 0.03, Z1);

  b.write("Car_Splitter_Wide.obj");
}

// ══════════════════════════════════════════════════════════════════════════════
// ADDITIONAL RIM STYLES  (same wheel layout as generate-wheel-variants.mjs)
// ══════════════════════════════════════════════════════════════════════════════

const WHEELS = [
  { cx: -0.842, cy: 0.40, cz: -1.285, side: -1 },
  { cx:  0.843, cy: 0.40, cz: -1.285, side:  1 },
  { cx: -0.842, cy: 0.40, cz:  1.285, side: -1 },
  { cx:  0.843, cy: 0.40, cz:  1.285, side:  1 },
];

const W = { outerR: 0.40, rimR: 0.34, hubR: 0.095, halfW: 0.10, segs: 24 };

function buildAllWheels(styleName, spokeFn) {
  const b = new OBJBuilder(styleName);

  for (const { cx, cy, cz, side } of WHEELS) {
    const xo   = cx - side * W.halfW; // outer face
    const xi   = cx + side * W.halfW; // inner face
    const flip = side === 1;

    function rv(x, r, n = W.segs) {
      const out = [];
      for (let i = 0; i < n; i++) {
        const a = (PI2 * i) / n;
        out.push(b.v(x, cy + r * Math.cos(a), cz + r * Math.sin(a)));
      }
      return out;
    }

    const oRingO = rv(xo, W.outerR);
    const oRingI = rv(xi, W.outerR);
    const rRingO = rv(xo, W.rimR);
    const hRingO = rv(xo, W.hubR);
    const hRingI = rv(xi, W.hubR);
    const cO     = b.v(xo, cy, cz);
    const cI     = b.v(xi, cy, cz);

    const S = W.segs;

    // Tire sidewall
    for (let i = 0; i < S; i++) {
      const j = (i + 1) % S;
      if (!flip) b.f(oRingO[i], oRingI[i], oRingI[j], oRingO[j]);
      else       b.f(oRingO[j], oRingI[j], oRingI[i], oRingO[i]);
    }

    // Outer rim annulus
    for (let i = 0; i < S; i++) {
      const j = (i + 1) % S;
      if (!flip) b.f(oRingO[i], oRingO[j], rRingO[j], rRingO[i]);
      else       b.f(oRingO[j], oRingO[i], rRingO[i], rRingO[j]);
    }

    // Hub cap outer
    for (let i = 0; i < S; i++) {
      const j = (i + 1) % S;
      if (!flip) b.f(cO, hRingO[i], hRingO[j]);
      else       b.f(cO, hRingO[j], hRingO[i]);
    }

    // Hub barrel
    for (let i = 0; i < S; i++) {
      const j = (i + 1) % S;
      if (!flip) b.f(hRingO[i], hRingI[i], hRingI[j], hRingO[j]);
      else       b.f(hRingO[j], hRingI[j], hRingI[i], hRingO[i]);
    }

    // Hub cap inner
    for (let i = 0; i < S; i++) {
      const j = (i + 1) % S;
      if (!flip) b.f(cI, hRingI[j], hRingI[i]);
      else       b.f(cI, hRingI[i], hRingI[j]);
    }

    // Style spokes
    spokeFn(b, cx, cy, cz, xo, xi, flip);
  }

  return b;
}

/** Y-spoke: each spoke splits into two prongs at the rim — luxury / aggressive. */
function buildYSpoke() {
  buildAllWheels("Y_Spoke", (b, _cx, cy, cz, xo, xi, flip) => {
    const N = 5;
    const PRONG_SPLIT = 0.22; // angular spread of prong tips (radians)

    for (let s = 0; s < N; s++) {
      const aCenter = (PI2 * s) / N;

      // Stem (narrow, from hub to ~60% out)
      const midR = W.hubR + (W.rimR - W.hubR) * 0.55;
      const stemHW = 0.07;

      const shO = [
        b.v(xo, cy + W.hubR * Math.cos(aCenter - stemHW), cz + W.hubR * Math.sin(aCenter - stemHW)),
        b.v(xo, cy + W.hubR * Math.cos(aCenter + stemHW), cz + W.hubR * Math.sin(aCenter + stemHW)),
        b.v(xo, cy + midR   * Math.cos(aCenter + stemHW), cz + midR   * Math.sin(aCenter + stemHW)),
        b.v(xo, cy + midR   * Math.cos(aCenter - stemHW), cz + midR   * Math.sin(aCenter - stemHW)),
      ];
      const shI = [
        b.v(xi, cy + W.hubR * Math.cos(aCenter - stemHW), cz + W.hubR * Math.sin(aCenter - stemHW)),
        b.v(xi, cy + W.hubR * Math.cos(aCenter + stemHW), cz + W.hubR * Math.sin(aCenter + stemHW)),
        b.v(xi, cy + midR   * Math.cos(aCenter + stemHW), cz + midR   * Math.sin(aCenter + stemHW)),
        b.v(xi, cy + midR   * Math.cos(aCenter - stemHW), cz + midR   * Math.sin(aCenter - stemHW)),
      ];

      if (!flip) b.f(shO[0], shO[1], shO[2], shO[3]);
      else       b.f(shO[3], shO[2], shO[1], shO[0]);
      if (!flip) b.f(shI[0], shI[3], shI[2], shI[1]);
      else       b.f(shI[1], shI[2], shI[3], shI[0]);
      b.f(shO[0], shI[0], shI[3], shO[3]);
      b.f(shO[1], shO[2], shI[2], shI[1]);

      // Two prongs (fork toward rim from midR)
      for (const pSign of [-1, 1]) {
        const pAngle = aCenter + pSign * PRONG_SPLIT * 0.5;
        const pHW    = 0.045;
        const a0 = pAngle - pHW, a1 = pAngle + pHW;

        const ro0 = b.v(xo, cy + W.rimR * Math.cos(a0), cz + W.rimR * Math.sin(a0));
        const ro1 = b.v(xo, cy + W.rimR * Math.cos(a1), cz + W.rimR * Math.sin(a1));
        const mo0 = b.v(xo, cy + midR   * Math.cos(a0), cz + midR   * Math.sin(a0));
        const mo1 = b.v(xo, cy + midR   * Math.cos(a1), cz + midR   * Math.sin(a1));
        const ri0 = b.v(xi, cy + W.rimR * Math.cos(a0), cz + W.rimR * Math.sin(a0));
        const ri1 = b.v(xi, cy + W.rimR * Math.cos(a1), cz + W.rimR * Math.sin(a1));
        const mi0 = b.v(xi, cy + midR   * Math.cos(a0), cz + midR   * Math.sin(a0));
        const mi1 = b.v(xi, cy + midR   * Math.cos(a1), cz + midR   * Math.sin(a1));

        if (!flip) b.f(mo0, ro0, ro1, mo1);
        else       b.f(mo1, ro1, ro0, mo0);
        if (!flip) b.f(mi0, mi1, ri1, ri0);
        else       b.f(mi1, mi0, ri0, ri1);
        b.f(ro0, ri0, mi0, mo0);
        b.f(ro1, mo1, mi1, ri1);
      }
    }
  }).write("Car_Wheels_YSpoke.obj");
}

/** Tri-spoke: 3 very wide blade spokes — motorsport / track look. */
function buildTriSpoke() {
  buildAllWheels("Tri_Spoke", (b, _cx, cy, cz, xo, xi, flip) => {
    const N = 3;
    const BLADE_W = 0.30; // wide blade

    for (let s = 0; s < N; s++) {
      const a    = (PI2 * s) / N;
      const a0   = a - BLADE_W / 2;
      const a1   = a + BLADE_W / 2;

      // Taper: wide at rim, narrow at hub
      const hubHW = 0.09;
      const aH0 = a - hubHW, aH1 = a + hubHW;

      const ro0 = b.v(xo, cy + W.rimR * Math.cos(a0), cz + W.rimR * Math.sin(a0));
      const ro1 = b.v(xo, cy + W.rimR * Math.cos(a1), cz + W.rimR * Math.sin(a1));
      const ho0 = b.v(xo, cy + W.hubR * Math.cos(aH0), cz + W.hubR * Math.sin(aH0));
      const ho1 = b.v(xo, cy + W.hubR * Math.cos(aH1), cz + W.hubR * Math.sin(aH1));
      const ri0 = b.v(xi, cy + W.rimR * Math.cos(a0), cz + W.rimR * Math.sin(a0));
      const ri1 = b.v(xi, cy + W.rimR * Math.cos(a1), cz + W.rimR * Math.sin(a1));
      const hi0 = b.v(xi, cy + W.hubR * Math.cos(aH0), cz + W.hubR * Math.sin(aH0));
      const hi1 = b.v(xi, cy + W.hubR * Math.cos(aH1), cz + W.hubR * Math.sin(aH1));

      if (!flip) b.f(ho0, ro0, ro1, ho1);
      else       b.f(ho1, ro1, ro0, ho0);
      if (!flip) b.f(hi0, hi1, ri1, ri0);
      else       b.f(hi1, hi0, ri0, ri1);
      b.f(ro0, ri0, hi0, ho0);
      b.f(ro1, ho1, hi1, ri1);
    }
  }).write("Car_Wheels_TriSpoke.obj");
}

/** Monoblock: solid face with 5 oval pockets milled out. */
function buildMonoblock() {
  buildAllWheels("Monoblock", (b, _cx, cy, cz, xo, xi, flip) => {
    // Solid face disc from hub to rim
    const discO = [];
    const discI = [];
    const N = W.segs;

    for (let i = 0; i < N; i++) {
      const a = (PI2 * i) / N;
      discO.push(b.v(xo, cy + W.rimR * Math.cos(a), cz + W.rimR * Math.sin(a)));
      discI.push(b.v(xi, cy + W.rimR * Math.cos(a), cz + W.rimR * Math.sin(a)));
    }

    const hO = [];
    const hI = [];
    for (let i = 0; i < N; i++) {
      const a = (PI2 * i) / N;
      hO.push(b.v(xo, cy + W.hubR * Math.cos(a), cz + W.hubR * Math.sin(a)));
      hI.push(b.v(xi, cy + W.hubR * Math.cos(a), cz + W.hubR * Math.sin(a)));
    }

    // Outer face as annulus (hub → rim)
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      if (!flip) b.f(discO[i], discO[j], hO[j], hO[i]);
      else       b.f(discO[j], discO[i], hO[i], hO[j]);
    }

    // Milled oval pockets on outer face (5 pocket rings)
    const POCKETS = 5;
    const pMidR   = (W.rimR + W.hubR) / 2;
    const pRadZ   = 0.055; // pocket oval Z radius
    const pRadY   = 0.025; // pocket oval Y radius
    const PTS     = 10;

    for (let p = 0; p < POCKETS; p++) {
      const aCenter = (PI2 * p) / POCKETS;
      const pcY = cy + pMidR * Math.cos(aCenter);
      const pcZ = cz + pMidR * Math.sin(aCenter);

      // Inset ring (slightly behind outer face)
      const xInset = xo + (flip ? 0.015 : -0.015);
      const pOuter = [];
      const pInner = [];
      for (let k = 0; k < PTS; k++) {
        const ta = (PI2 * k) / PTS;
        // Rotate pocket orientation to align with spoke angle
        const dy =  pRadY * Math.cos(ta) * Math.cos(aCenter) - pRadZ * Math.sin(ta) * Math.sin(aCenter);
        const dz =  pRadY * Math.cos(ta) * Math.sin(aCenter) + pRadZ * Math.sin(ta) * Math.cos(aCenter);
        pOuter.push(b.v(xo,     pcY + dy, pcZ + dz));
        pInner.push(b.v(xInset, pcY + dy, pcZ + dz));
      }

      // Pocket walls
      for (let k = 0; k < PTS; k++) {
        const l = (k + 1) % PTS;
        b.f(pOuter[k], pOuter[l], pInner[l], pInner[k]);
      }

      // Pocket floor
      const pCtr = b.v(xInset, pcY, pcZ);
      for (let k = 0; k < PTS; k++) {
        const l = (k + 1) % PTS;
        if (!flip) b.f(pCtr, pInner[k], pInner[l]);
        else       b.f(pCtr, pInner[l], pInner[k]);
      }
    }

    // Inner face annulus
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      if (!flip) b.f(discI[i], hI[i], hI[j], discI[j]);
      else       b.f(discI[j], hI[j], hI[i], discI[i]);
    }
  }).write("Car_Wheels_Monoblock.obj");
}

/** Deep-dish: very wide barrel, recessed face — classic stance look. */
function buildDeepDish() {
  buildAllWheels("Deep_Dish", (b, _cx, cy, cz, xo, _xi, flip) => {
    const DISH_DEPTH = 0.07; // how far in the face is recessed
    const xFace = xo + (flip ? DISH_DEPTH : -DISH_DEPTH);
    const N = W.segs;

    // Outer rim to dish edge ring
    const outerRingXo = [];
    const faceRimRing = [];
    const faceHubRing = [];

    for (let i = 0; i < N; i++) {
      const a = (PI2 * i) / N;
      outerRingXo.push(b.v(xo,    cy + W.outerR * Math.cos(a), cz + W.outerR * Math.sin(a)));
      faceRimRing.push(b.v(xFace, cy + W.rimR   * Math.cos(a), cz + W.rimR   * Math.sin(a)));
      faceHubRing.push(b.v(xFace, cy + W.hubR   * Math.cos(a), cz + W.hubR   * Math.sin(a)));
    }

    const cFace = b.v(xFace, cy, cz);

    // Dish step: outer rim ring → face rim ring (angled dish wall)
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      if (!flip) b.f(outerRingXo[i], outerRingXo[j], faceRimRing[j], faceRimRing[i]);
      else       b.f(outerRingXo[j], outerRingXo[i], faceRimRing[i], faceRimRing[j]);
    }

    // Face annulus (hub → rim)
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      if (!flip) b.f(faceRimRing[i], faceRimRing[j], faceHubRing[j], faceHubRing[i]);
      else       b.f(faceRimRing[j], faceRimRing[i], faceHubRing[i], faceHubRing[j]);
    }

    // Hub cap
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      if (!flip) b.f(cFace, faceHubRing[i], faceHubRing[j]);
      else       b.f(cFace, faceHubRing[j], faceHubRing[i]);
    }

    // 7-spoke pattern on dish face
    const N_SPOKES = 7, HW = 0.05;
    for (let s = 0; s < N_SPOKES; s++) {
      const a  = (PI2 * s) / N_SPOKES;
      const a0 = a - HW, a1 = a + HW;
      const ro0 = b.v(xFace, cy + W.rimR * Math.cos(a0), cz + W.rimR * Math.sin(a0));
      const ro1 = b.v(xFace, cy + W.rimR * Math.cos(a1), cz + W.rimR * Math.sin(a1));
      const ho0 = b.v(xFace, cy + W.hubR * Math.cos(a0), cz + W.hubR * Math.sin(a0));
      const ho1 = b.v(xFace, cy + W.hubR * Math.cos(a1), cz + W.hubR * Math.sin(a1));
      if (!flip) b.f(ho0, ro0, ro1, ho1);
      else       b.f(ho1, ro1, ro0, ho0);
    }
  }).write("Car_Wheels_DeepDish.obj");
}

// ══════════════════════════════════════════════════════════════════════════════
// HOOD SCOOPS
// Hood surface: Y≈1.03–1.07, Z≈+0.30 to +2.20 (positive Z = front)
// Scoop sits proud of hood, faces forward for ram-air intake.
// ══════════════════════════════════════════════════════════════════════════════

/** Center ram-air scoop with raised cowl and side vent slots. */
function buildHoodScoop() {
  const b = new OBJBuilder("Hood_Scoop");
  const CX = 0.007;  // car center X
  const HW = 0.15;   // half-width of scoop body
  const Y_BASE = 1.05; // just proud of hood surface
  const Y_TOP  = 1.20; // peak of cowl
  const Z_REAR = 0.62; // rear of scoop (toward windshield)
  const Z_FRONT = 1.44; // front of scoop (facing camera/front)

  // Main cowl body
  b.box(CX - HW, CX + HW, Y_BASE, Y_TOP, Z_REAR, Z_FRONT);

  // Raised crown strip (top of scoop, slightly narrower)
  b.box(CX - HW * 0.65, CX + HW * 0.65, Y_TOP, Y_TOP + 0.035, Z_REAR + 0.12, Z_FRONT - 0.10);

  // Forward intake lip (taller thin box at front edge — the "mouth")
  b.box(CX - HW, CX + HW, Y_BASE, Y_TOP + 0.05, Z_FRONT - 0.025, Z_FRONT + 0.02);

  // Side vent louvers (two small horizontal fins on each side)
  for (const sx of [-1, 1]) {
    const vx = CX + sx * (HW + 0.005);
    for (const dz of [0.10, 0.30]) {
      b.box(vx, vx + sx * 0.032, Y_BASE + 0.04, Y_BASE + 0.06, Z_REAR + dz, Z_REAR + dz + 0.14);
    }
  }

  b.write("Car_Hood_Scoop.obj");
}

// ══════════════════════════════════════════════════════════════════════════════
// REAR DIFFUSER
// Car underbody at Z=-1.80 to -2.27 is uniformly at Y=0.30 (confirmed).
// Shelf plate at Y=0.24–0.32 connects to bumper. Fins hang below to Y=0.07.
// ══════════════════════════════════════════════════════════════════════════════

/** Rear underbody diffuser: thin shelf plate at bumper bottom + hanging fins. */
function buildRearDiffuser() {
  const b = new OBJBuilder("Rear_Diffuser");
  const CX = 0.007;
  const HW = 0.88;
  const Z0 = -2.27;    // rear edge flush with bumper face at Z≈-2.275
  const Z1 = -1.82;    // front edge

  // Thin shelf plate connecting to bumper bottom at Y≈0.30
  b.box(CX - HW, CX + HW, 0.24, 0.32, Z0, Z1);

  // 5 vertical fins hanging BELOW the shelf
  const FIN_W = 0.022;
  for (let i = 0; i < 5; i++) {
    const fx = CX - HW * 0.72 + (i * HW * 1.44) / 4;
    b.box(fx - FIN_W / 2, fx + FIN_W / 2, 0.07, 0.24, Z0 + 0.04, Z1 - 0.04);
  }

  // Rear valance — vertical lip at rear edge
  b.box(CX - HW, CX + HW, 0.07, 0.34, Z0 - 0.01, Z0 + 0.025);

  b.write("Car_Diffuser_Rear.obj");
}

// ══════════════════════════════════════════════════════════════════════════════
// RUN ALL
// ══════════════════════════════════════════════════════════════════════════════

console.log("\nSpoilers:");
buildGTWing();
buildDucktail();
buildLipSpoiler();
buildWidebodyWing();

console.log("\nExhausts:");
buildExhaustSingle();
buildExhaustDual();
buildExhaustQuad();

console.log("\nFront Splitters:");
buildSplitterLip();
buildSplitterTrack();
buildSplitterWide();

console.log("\nWheel rims:");
buildYSpoke();
buildTriSpoke();
buildMonoblock();
buildDeepDish();

console.log("\nHood Scoops:");
buildHoodScoop();

console.log("\nRear Diffusers:");
buildRearDiffuser();

console.log("\nDone. Add new part IDs to src/data/carParts.ts to use them in game.");
