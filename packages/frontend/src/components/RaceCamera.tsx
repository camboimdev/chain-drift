import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MathUtils, Vector3 } from "three";
import type { PerspectiveCamera } from "three";
import { useRaceStore } from "../stores/raceStore";
import { getLanePosition, TRACK_CONFIG } from "../config/trackConfig";
import type { CameraMode, RaceParticipant, RaceState } from "@chain-drift/shared";

interface RaceCameraProps {
  enabled?: boolean;
}

/**
 * Broadcast camera.
 *
 * The grammar is "hold, then cut": every shot holds a stable framing for a
 * meaningful beat and then hard-cuts to a different one. Nothing orbits, sways
 * or drifts on several axes at once — when a shot moves, it moves on a single
 * axis with a clear intent (a chase locked behind the car, a dolly that follows
 * the pack, a static tripod that pans as the cars go past).
 *
 * Every decision (which shot, which subject, which rig) is taken once, at the
 * cut. Nothing is re-evaluated per frame, so targets can never fight each other.
 */

// ---------------------------------------------------------------------------
// Track-space constants
// ---------------------------------------------------------------------------

const FINISH_Z = TRACK_CONFIG.totalDistance;
const TRACK_HALF = TRACK_CONFIG.trackWidth / 2;
/** Cars sit at y = 0 (wheel contact); frame the body/roof, not the wheels. */
const CAR_LOOK_Y = 0.9;

// ---------------------------------------------------------------------------
// Trackside rigs — virtual tripods placed along the track, cut between as the
// cars approach them. A static camera that pans is the most convincing racing
// shot there is, and the track dressing (kerbs, barriers, poles) plays against
// the low ones.
// ---------------------------------------------------------------------------

/** 0 = low kerb-level, 1 = mid three-quarter, 2 = high wide. */
type RigTier = 0 | 1 | 2;

interface TracksideRig {
  x: number;
  y: number;
  z: number;
  tier: RigTier;
}

/**
 * Lateral offsets measured from the edge of the asphalt, matching the track
 * cross-section: kerb out to +1.4, run-off apron out to +5.4, barrier wall at
 * +5.4. Tier 0 stands on the apron just behind the kerb, tier 1 hugs the inside
 * of the wall, tier 2 is a tower outside the barrier looking over it.
 */
const TRACKSIDE_RIGS: TracksideRig[] = (() => {
  const rigs: TracksideRig[] = [];
  const spacing = 65;
  let index = 0;
  for (let z = 70; z < FINISH_Z - 30; z += spacing, index++) {
    const side = index % 2 === 0 ? 1 : -1;
    const tier = (index % 3) as RigTier;
    const lateral = tier === 0 ? 2.4 : tier === 1 ? 4.2 : 9.5;
    const height = tier === 0 ? 0.75 : tier === 1 ? 2.2 : 5.6;
    rigs.push({ x: side * (TRACK_HALF + lateral), y: height, z, tier });
  }
  return rigs;
})();

/**
 * Rig of the requested tier whose lead distance is closest to the ideal: far
 * enough that the car is seen approaching for a couple of seconds, close enough
 * that it fills the frame before it goes past.
 */
function findRigAhead(subjectZ: number, tier: RigTier): TracksideRig | null {
  const preferredLead = tier === 0 ? 95 : tier === 1 ? 110 : 125;
  let best: TracksideRig | null = null;
  let bestError = Number.POSITIVE_INFINITY;
  for (const rig of TRACKSIDE_RIGS) {
    if (rig.tier !== tier) continue;
    const ahead = rig.z - subjectZ;
    if (ahead < 55 || ahead > 260) continue;
    const error = Math.abs(ahead - preferredLead);
    if (error < bestError) {
      bestError = error;
      best = rig;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Shot definitions
// ---------------------------------------------------------------------------

type ShotKind =
  | "CHASE" // locked behind the subject, no sway
  | "ONBOARD" // bumper height, close, long view down the track
  | "TRACKSIDE_PAN" // static tripod, pans as the subject goes past
  | "LOW_KERB" // static kerb-level tripod, cars whip through frame
  | "AERIAL" // high wide, single-axis dolly with the pack
  | "BATTLE" // static tripod framing the two leading cars
  | "GRID" // composed static shot of the starting grid
  | "FINISH_WIDE" // past the line, looking back up the track
  | "FINISH_LOW"; // low at the line

/** Which grammar the race state / camera mode asks for. */
type ShotFamily =
  | "GRID"
  | "CINEMATIC"
  | "USER_LOCK"
  | "LEADER_LOCK"
  | "AERIAL_LOCK"
  | "FINISH";

interface Shot {
  kind: ShotKind;
  family: ShotFamily;
  subjectId: string | null;
  secondaryId: string | null;
  startTime: number;
  /** Fixed world position for static shots. */
  anchor: Vector3;
  fov: number;
  /** Extra FOV at full speed. Zero on static shots — a tripod has one lens. */
  fovSpeedGain: number;
  /** Framerate-independent damping rates, per axis, for the rig position. */
  lambdaX: number;
  lambdaY: number;
  lambdaZ: number;
  /** Pan rate. Kept close to the position rates so the frame never slides. */
  lambdaLook: number;
  /** How much of an event shake this shot transmits (a tripod barely moves). */
  shakeScale: number;
  /** Continuous speed-driven micro-vibration, for on-car shots only. */
  vibration: number;
  endTime: number;
  /** Cut once the subject has passed this Z, so a tripod never pans backwards. */
  passZ: number | null;
}

const SHOT_DURATION: Record<ShotKind, number> = {
  CHASE: 6.5,
  ONBOARD: 4.5,
  TRACKSIDE_PAN: 6.0,
  LOW_KERB: 5.0,
  AERIAL: 7.5,
  BATTLE: 6.0,
  GRID: 999,
  FINISH_WIDE: 6.5,
  FINISH_LOW: 5.5,
};

/** Hard floor on a shot that ends on the clock. */
const MIN_SHOT_DURATION = 2.6;
/**
 * Floor on a shot that ends because the subject went past the tripod. Lower,
 * because that cut is motivated: the car has left the frame.
 */
const MIN_PASS_DURATION = 1.2;

/** Shots that keep the player on screen, and shots that show the race. */
const PLAYER_SHOTS: ShotKind[] = ["CHASE", "ONBOARD", "CHASE", "TRACKSIDE_PAN"];
const WORLD_SHOTS: ShotKind[] = ["TRACKSIDE_PAN", "LOW_KERB", "AERIAL", "LOW_KERB"];

/** Deterministic hash — no Math.random anywhere in the camera. */
function hash01(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RaceCamera({ enabled = true }: RaceCameraProps) {
  const { camera } = useThree();
  const raceState = useRaceStore((state) => state.raceState);
  const setCameraMode = useRaceStore((state) => state.setCameraMode);

  // Scratch state — every Vector3 is allocated once, never inside the frame loop.
  const targetPosRef = useRef(new Vector3());
  const targetLookRef = useRef(new Vector3());
  const posRef = useRef(new Vector3());
  const lookRef = useRef(new Vector3());
  const shotRef = useRef<Shot | null>(null);
  const timeRef = useRef(0);
  const shotIndexRef = useRef(0);
  const lastBattleIndexRef = useRef(-99);
  const fovRef = useRef(55);
  const shakeAmpRef = useRef(0);
  const modeSwitchGuardRef = useRef(0);

  /** Predicted subject progress — the store publishes on a throttle. */
  const trackerRef = useRef({
    id: "",
    progress: 0,
    rate: 0,
    lastStore: 0,
    sinceChange: 0,
  });

  // Reset the grammar whenever the race state changes, and punctuate the two
  // moments that genuinely deserve a jolt: the start and the finish.
  useEffect(() => {
    shotRef.current = null;
    shotIndexRef.current = 0;
    lastBattleIndexRef.current = -99;
    timeRef.current = 0;
    modeSwitchGuardRef.current = -10;
    // Drop the prediction: the same car id may line up again at progress 0.
    trackerRef.current.id = "";
    if (raceState === "RACING") shakeAmpRef.current = 0.45;
    else if (raceState === "FINISHED") shakeAmpRef.current = 0.3;
    else shakeAmpRef.current = 0;
  }, [raceState]);

  useFrame((_state, rawDelta) => {
    if (!enabled) return;

    // Clamp the step so a tab-switch or a hitch can never fling the rig.
    const delta = Math.min(rawDelta, 0.1);
    timeRef.current += delta;
    const now = timeRef.current;

    const { participants, userCarId, camera: cameraState } = useRaceStore.getState();

    // --- Read the race without allocating -------------------------------
    let leader: RaceParticipant | null = null;
    let second: RaceParticipant | null = null;
    let userCar: RaceParticipant | null = null;
    let progressSum = 0;
    for (const p of participants) {
      progressSum += p.progress;
      if (!leader || p.progress > leader.progress) {
        second = leader;
        leader = p;
      } else if (!second || p.progress > second.progress) {
        second = p;
      }
      if (p.car.id === userCarId) userCar = p;
    }
    const packZ =
      participants.length > 0 ? (progressSum / participants.length) * FINISH_Z : 0;

    // --- Mode arbitration, throttled and one-way ------------------------
    if (raceState === "RACING" && leader && now - modeSwitchGuardRef.current > 1) {
      if (leader.progress > 0.94 && cameraState.mode !== "FINISH_LINE") {
        setCameraMode("FINISH_LINE");
        modeSwitchGuardRef.current = now;
      }
    }

    const family = resolveFamily(raceState, cameraState.mode);

    // --- Cut decision ---------------------------------------------------
    let shot = shotRef.current;
    let didCut = false;

    if (shot !== null) {
      const subjectForShot = findParticipant(participants, shot.subjectId);
      const elapsed = now - shot.startTime;
      const passed =
        shot.passZ !== null &&
        subjectForShot !== null &&
        subjectForShot.progress * FINISH_Z > shot.passZ;

      didCut =
        shot.family !== family ||
        (subjectForShot === null && shot.subjectId !== null) ||
        (elapsed > MIN_SHOT_DURATION && now >= shot.endTime) ||
        (elapsed > MIN_PASS_DURATION && passed);
    }

    if (shot === null || didCut) {
      didCut = true;
      const cutIndex = shotIndexRef.current++;
      shot = buildShot({
        family,
        now,
        index: cutIndex,
        previous: shotRef.current,
        leader,
        second,
        userCar,
        lastBattleIndex: lastBattleIndexRef.current,
      });
      if (shot.kind === "BATTLE") lastBattleIndexRef.current = cutIndex;
      shotRef.current = shot;
    }

    // --- Subject prediction ---------------------------------------------
    const subject = findParticipant(participants, shot.subjectId);
    const subjectZ = subject
      ? advanceTracker(trackerRef.current, subject, delta) * FINISH_Z
      : packZ;
    const subjectX = subject ? getLanePosition(subject.laneIndex) : 0;
    const speedFactor = subject ? MathUtils.clamp(subject.currentSpeed / 140, 0, 1) : 0;

    // --- Framing ---------------------------------------------------------
    const target = targetPosRef.current;
    const look = targetLookRef.current;

    switch (shot.kind) {
      case "CHASE": {
        // Locked behind the car: fixed height, fixed distance, no sway. The X
        // axis is loose so the car weaves inside a held frame instead of the
        // camera copying the weave.
        target.set(subjectX, 4.0, subjectZ - 13);
        look.set(subjectX, CAR_LOOK_Y + 0.3, subjectZ + 17);
        break;
      }
      case "ONBOARD": {
        target.set(subjectX, 1.35, subjectZ - 5.2);
        look.set(subjectX, CAR_LOOK_Y + 0.2, subjectZ + 42);
        break;
      }
      case "AERIAL": {
        // One axis only: the rig dollies down-track with the pack.
        target.set(0, 34, packZ - 58);
        look.set(0, 1.2, packZ + 26);
        break;
      }
      case "TRACKSIDE_PAN":
      case "LOW_KERB": {
        // Tripod holds; only the pan tracks the car, with a small lead.
        target.copy(shot.anchor);
        look.set(subjectX, CAR_LOOK_Y, subjectZ + 4);
        break;
      }
      case "BATTLE": {
        const challenger = findParticipant(participants, shot.secondaryId);
        const otherZ = challenger ? challenger.progress * FINISH_Z : subjectZ;
        const otherX = challenger ? getLanePosition(challenger.laneIndex) : subjectX;
        target.copy(shot.anchor);
        look.set((subjectX + otherX) / 2, CAR_LOOK_Y, (subjectZ + otherZ) / 2 + 3);
        break;
      }
      case "GRID": {
        // Cars are lined up at Z = 0. Hold it completely still.
        target.copy(shot.anchor);
        look.set(-1, CAR_LOOK_Y, 6);
        break;
      }
      case "FINISH_WIDE":
      case "FINISH_LOW": {
        target.copy(shot.anchor);
        look.set(subjectX * 0.6, CAR_LOOK_Y, Math.min(subjectZ, FINISH_Z - 2));
        break;
      }
    }

    // --- Damping ----------------------------------------------------------
    // Framerate-independent throughout: MathUtils.damp is lerp(a, b, 1 - e^-λdt).
    // Position and look-at run at comparable rates so the frame never slides.
    if (didCut) {
      // A cut is a cut: teleport the rig, snap the framing, reset the lens.
      posRef.current.copy(target);
      lookRef.current.copy(look);
      fovRef.current = shot.fov;
    } else {
      posRef.current.set(
        MathUtils.damp(posRef.current.x, target.x, shot.lambdaX, delta),
        MathUtils.damp(posRef.current.y, target.y, shot.lambdaY, delta),
        MathUtils.damp(posRef.current.z, target.z, shot.lambdaZ, delta)
      );
      lookRef.current.set(
        MathUtils.damp(lookRef.current.x, look.x, shot.lambdaLook, delta),
        MathUtils.damp(lookRef.current.y, look.y, shot.lambdaLook, delta),
        MathUtils.damp(lookRef.current.z, look.z, shot.lambdaLook, delta)
      );
    }

    camera.position.copy(posRef.current);

    // --- Shake: event impulses plus on-car vibration, never white noise ----
    shakeAmpRef.current *= Math.exp(-3.2 * delta);
    const shakeAmount =
      shakeAmpRef.current * shot.shakeScale + shot.vibration * speedFactor;
    if (shakeAmount > 0.0005) {
      const t = now;
      const sx = Math.sin(t * 18.7) * 0.6 + Math.sin(t * 7.3) * 0.4;
      const sy = Math.sin(t * 22.1) * 0.5 + Math.sin(t * 9.7) * 0.5;
      camera.position.x += sx * shakeAmount;
      camera.position.y += sy * shakeAmount * 0.6;
    }

    // --- Motivated FOV ----------------------------------------------------
    const perspective = camera as PerspectiveCamera;
    const targetFov = shot.fov + shot.fovSpeedGain * speedFactor;
    fovRef.current = MathUtils.damp(fovRef.current, targetFov, 1.8, delta);
    if (Math.abs(perspective.fov - fovRef.current) > 0.001) {
      perspective.fov = fovRef.current;
      perspective.updateProjectionMatrix();
    }

    camera.lookAt(lookRef.current);
  });

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findParticipant(
  participants: RaceParticipant[],
  id: string | null
): RaceParticipant | null {
  if (!id) return null;
  for (const p of participants) if (p.car.id === id) return p;
  return null;
}

function resolveFamily(raceState: RaceState, mode: CameraMode): ShotFamily {
  if (raceState === "COUNTDOWN") return "GRID";
  if (raceState === "FINISHED") return "FINISH";
  switch (mode) {
    case "FINISH_LINE":
      return "FINISH";
    case "USER_CAR":
      return "USER_LOCK";
    case "LEADER":
      return "LEADER_LOCK";
    case "OVERVIEW":
      return "AERIAL_LOCK";
    default:
      return "CINEMATIC";
  }
}

/**
 * The store publishes progress on a throttle, so the raw value is a staircase.
 * Estimate the subject's rate from the store deltas and integrate between
 * updates: the chase camera then rides a continuous position no matter what
 * cadence the director publishes at.
 */
function advanceTracker(
  tracker: {
    id: string;
    progress: number;
    rate: number;
    lastStore: number;
    sinceChange: number;
  },
  subject: RaceParticipant,
  delta: number
): number {
  if (tracker.id !== subject.car.id) {
    tracker.id = subject.car.id;
    tracker.progress = subject.progress;
    tracker.lastStore = subject.progress;
    tracker.rate = 0;
    tracker.sinceChange = 0;
    return tracker.progress;
  }

  tracker.sinceChange += delta;
  if (subject.progress !== tracker.lastStore) {
    const advanced = subject.progress - tracker.lastStore;
    if (advanced > 0 && tracker.sinceChange > 1e-4) {
      const measured = advanced / tracker.sinceChange;
      tracker.rate =
        tracker.rate === 0
          ? measured
          : MathUtils.damp(tracker.rate, measured, 4, tracker.sinceChange);
    }
    tracker.lastStore = subject.progress;
    tracker.sinceChange = 0;
  }

  const authoritative = tracker.lastStore + tracker.rate * tracker.sinceChange;
  tracker.progress += tracker.rate * delta;
  tracker.progress = MathUtils.damp(tracker.progress, authoritative, 6, delta);
  tracker.progress = MathUtils.clamp(tracker.progress, 0, 1);
  return tracker.progress;
}

interface ShotRequest {
  family: ShotFamily;
  now: number;
  index: number;
  previous: Shot | null;
  leader: RaceParticipant | null;
  second: RaceParticipant | null;
  userCar: RaceParticipant | null;
  lastBattleIndex: number;
}

/**
 * All shot selection happens here, once per cut. Nothing below is ever
 * re-evaluated mid-shot, which is what keeps the framing still.
 */
function buildShot(request: ShotRequest): Shot {
  const { family, now, index, previous, leader, second, userCar } = request;

  if (family === "GRID") {
    return makeShot({
      kind: "GRID",
      family,
      now,
      subject: null,
      anchor: new Vector3(15, 3.0, -17),
      fov: 40,
    });
  }

  if (family === "FINISH") {
    const subject = leader ?? userCar;
    const low = index % 2 === 1;
    return makeShot({
      kind: low ? "FINISH_LOW" : "FINISH_WIDE",
      family,
      now,
      subject,
      anchor: low
        ? new Vector3(TRACK_HALF + 3.5, 0.8, FINISH_Z + 9)
        : new Vector3(9, 3.4, FINISH_Z + 30),
      fov: low ? 50 : 42,
    });
  }

  if (family === "AERIAL_LOCK") {
    return makeShot({
      kind: "AERIAL",
      family,
      now,
      subject: leader ?? userCar,
      anchor: new Vector3(),
      fov: 50,
      duration: 9999,
    });
  }

  if (family === "USER_LOCK" || family === "LEADER_LOCK") {
    // The stable default: one locked shot, held for as long as the mode lasts.
    return makeShot({
      kind: "CHASE",
      family,
      now,
      subject: family === "LEADER_LOCK" ? leader ?? userCar : userCar ?? leader,
      anchor: new Vector3(),
      fov: 56,
      duration: 9999,
    });
  }

  // --- CINEMATIC ---------------------------------------------------------
  // Alternate: every other shot keeps the player on screen, so the viewer never
  // loses their own car for more than one beat.
  const focusPlayer = index % 2 === 0;
  const subjectPool = focusPlayer ? PLAYER_SHOTS : WORLD_SHOTS;
  let subject = focusPlayer ? userCar ?? leader : leader ?? userCar;

  // A genuine battle earns a shot of its own, but only decided here, at a cut.
  const gap =
    leader && second ? Math.abs(leader.progress - second.progress) : Number.POSITIVE_INFINITY;
  const battleReady =
    gap < 0.02 && index - request.lastBattleIndex >= 3 && leader !== null && second !== null;

  let kind: ShotKind;
  if (battleReady) {
    kind = "BATTLE";
    subject = leader;
  } else {
    const roll = Math.floor(hash01(index * 2654435761) * subjectPool.length);
    kind = subjectPool[roll];
    if (previous && kind === previous.kind) {
      kind = subjectPool[(roll + 1) % subjectPool.length];
    }
  }

  const subjectZ = subject ? subject.progress * FINISH_Z : 0;

  // Static shots need a rig standing far enough ahead; without one (near the
  // finish) fall back to the chase, which always works.
  if (kind === "TRACKSIDE_PAN" || kind === "LOW_KERB" || kind === "BATTLE") {
    const tier: RigTier = kind === "LOW_KERB" ? 0 : kind === "BATTLE" ? 1 : 2;
    const rig = findRigAhead(subjectZ, tier) ?? findRigAhead(subjectZ, 1);
    if (!rig) {
      return makeShot({
        kind: "CHASE",
        family,
        now,
        subject,
        anchor: new Vector3(),
        fov: 56,
      });
    }
    return makeShot({
      kind,
      family,
      now,
      subject,
      secondary: kind === "BATTLE" ? second : null,
      anchor: new Vector3(rig.x, rig.y, rig.z),
      fov: kind === "LOW_KERB" ? 46 : kind === "BATTLE" ? 52 : 44,
      passZ: rig.z + (kind === "LOW_KERB" ? 12 : 20),
    });
  }

  return makeShot({
    kind,
    family,
    now,
    subject,
    anchor: new Vector3(),
    fov: kind === "ONBOARD" ? 74 : 56,
  });
}

interface ShotSpec {
  kind: ShotKind;
  family: ShotFamily;
  now: number;
  subject: RaceParticipant | null;
  secondary?: RaceParticipant | null;
  anchor: Vector3;
  fov: number;
  duration?: number;
  passZ?: number;
}

/** Per-kind rig behaviour: how the shot is allowed to move, and how much. */
function makeShot(spec: ShotSpec): Shot {
  const staticRig =
    spec.kind === "TRACKSIDE_PAN" ||
    spec.kind === "LOW_KERB" ||
    spec.kind === "BATTLE" ||
    spec.kind === "GRID" ||
    spec.kind === "FINISH_WIDE" ||
    spec.kind === "FINISH_LOW";

  let lambdaX = 30;
  let lambdaY = 30;
  let lambdaZ = 30;
  let lambdaLook = 6;
  let fovSpeedGain = 0;
  let shakeScale = 0.25;
  let vibration = 0;

  switch (spec.kind) {
    case "CHASE":
      // Locked on Z and height, loose laterally so the car weaves in-frame.
      lambdaX = 1.6;
      lambdaY = 6;
      lambdaZ = 6;
      lambdaLook = 5;
      fovSpeedGain = 6;
      shakeScale = 0.8;
      vibration = 0.01;
      break;
    case "ONBOARD":
      lambdaX = 4;
      lambdaY = 9;
      lambdaZ = 9;
      lambdaLook = 7;
      fovSpeedGain = 8;
      shakeScale = 1;
      vibration = 0.02;
      break;
    case "AERIAL":
      // Single-axis dolly: X and Y are constant, only Z follows the pack.
      lambdaX = 2;
      lambdaY = 2;
      lambdaZ = 1.1;
      lambdaLook = 1.6;
      shakeScale = 0.1;
      break;
    case "TRACKSIDE_PAN":
      lambdaLook = 5.5;
      shakeScale = 0.2;
      break;
    case "LOW_KERB":
      lambdaLook = 7;
      shakeScale = 0.3;
      break;
    case "BATTLE":
      lambdaLook = 4.5;
      shakeScale = 0.2;
      break;
    case "GRID":
      lambdaLook = 3;
      shakeScale = 0;
      break;
    case "FINISH_WIDE":
    case "FINISH_LOW":
      lambdaLook = 4;
      shakeScale = 0.35;
      break;
  }

  return {
    kind: spec.kind,
    family: spec.family,
    subjectId: spec.subject ? spec.subject.car.id : null,
    secondaryId: spec.secondary ? spec.secondary.car.id : null,
    startTime: spec.now,
    anchor: spec.anchor,
    fov: spec.fov,
    fovSpeedGain,
    lambdaX,
    lambdaY,
    lambdaZ,
    lambdaLook,
    shakeScale,
    vibration,
    endTime: spec.now + (spec.duration ?? SHOT_DURATION[spec.kind]),
    passZ: staticRig ? spec.passZ ?? null : null,
  };
}

export default RaceCamera;
