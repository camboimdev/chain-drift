import { useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Group,
  InstancedMesh,
  MathUtils,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  Vector3,
} from "three";
import { useRaceStore } from "../stores/raceStore";
import type { RaceParticipant, AIBoostState } from "@chain-drift/shared";
import {
  calculateSpeedVariation,
  calculateTargetProgress,
  initializeAIBoostState,
  updateAIBoostState,
  calculateLaneDrift,
} from "@chain-drift/shared";
import { Car3D } from "./Car3D";
import { CarExhaust, type CarExhaustHandle } from "./effects/CarExhaust";
import {
  RaceTrack,
  getTrackPosition,
  getTrackRotation,
  isAtCorner,
} from "./RaceTrack";
import { TRACK_CONFIG } from "../config/trackConfig";

// ============================================================================
// Ground contract
// ----------------------------------------------------------------------------
// RaceTrack guarantees the drivable surface top is exactly y = 0, and Car3D
// lifts the GLB so the tyres sit at local y = 0. The car group therefore rides
// at y = 0 — anything added on top of that is suspension travel, measured in
// centimetres, never a fixed "car height" offset.
// ============================================================================

const GROUND_Y = 0;
/** Static tyre-sidewall deflection the body rides on. 2 cm on a 6 m car. */
const RIDE_HEIGHT = 0.02;
/** Peak suspension travel above/below the static ride height. */
const SUSPENSION_TRAVEL = 0.035;
/** Spring constant and damping of the body-on-suspension integrator. */
const SUSPENSION_STIFFNESS = 90;
const SUSPENSION_DAMPING = 14;

/** Car footprint, derived from Car3D's TARGET_CAR_LENGTH of 6 world units. */
const CAR_LENGTH = 6;
const CAR_HALF_LENGTH = CAR_LENGTH / 2;
const CAR_HALF_WIDTH = 1.25;
/** Rear contact patches, where dust is thrown and marks are laid down. */
const REAR_AXLE_Z = -1.95;
const REAR_TRACK_HALF = 1.05;

/** Weight-transfer limits. Kept small so the body never punches the asphalt. */
const MAX_PITCH = 0.022; // ~1.3 deg of squat / dive
const MAX_ROLL = 0.03; // ~1.7 deg of lean
const MAX_YAW = 0.05; // ~2.9 deg of steering into the lateral move

/** Normalisers turning raw per-frame deltas into -1..1 control signals. */
const LONGITUDINAL_ACCEL_REFERENCE = 45; // speed units per second
const LATERAL_VELOCITY_REFERENCE = 1.4; // world units per second
const TOP_SPEED_REFERENCE = 120;

/** Deterministic store write cadence, replacing the old coin-flip throttle. */
const STORE_UPDATE_INTERVAL = 0.1;

/** Ground decals. */
const SHADOW_Y = 0.012;
const MARK_Y = 0.008;
// Pool sizes, spawn rates and lifetimes are tuned together: at top speed a
// pool must not recycle a particle that is still visible, or the trail pops.
const DUST_POOL = 24;
const MARK_POOL = 20; // 10 pairs
const MARK_SPACING = 2.2; // world units of travel between mark pairs
const MARK_LENGTH = 2.4;
const MARK_WIDTH = 0.34;
const MARK_LIFETIME = 0.6;

const BRAND_ACCENT = "#00D1FF";

// ============================================================================
// Pooled GPU resources — created once and shared by every car on the grid.
// ============================================================================

let shadowTexture: CanvasTexture | null = null;
function getShadowTexture(): CanvasTexture {
  if (shadowTexture) return shadowTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0.0, "rgba(0,0,0,1)");
  gradient.addColorStop(0.45, "rgba(0,0,0,0.85)");
  gradient.addColorStop(0.75, "rgba(0,0,0,0.3)");
  gradient.addColorStop(1.0, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  shadowTexture = new CanvasTexture(canvas);
  return shadowTexture;
}

let dustTexture: CanvasTexture | null = null;
function getDustTexture(): CanvasTexture {
  if (dustTexture) return dustTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  // Gaussian-ish falloff with no hard core. An opaque centre under additive
  // blending reads as a glowing sphere, not as dust kicked off a tyre.
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0.0, "rgba(255,255,255,0.55)");
  gradient.addColorStop(0.25, "rgba(255,255,255,0.34)");
  gradient.addColorStop(0.55, "rgba(255,255,255,0.12)");
  gradient.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  dustTexture = new CanvasTexture(canvas);
  return dustTexture;
}

let markTexture: CanvasTexture | null = null;
function getMarkTexture(): CanvasTexture {
  if (markTexture) return markTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  // White RGB is mandatory here: the marks blend additively, and a black
  // source texture would multiply out to nothing.
  const across = ctx.createLinearGradient(0, 0, 32, 0);
  across.addColorStop(0.0, "rgba(255,255,255,0)");
  across.addColorStop(0.35, "rgba(255,255,255,1)");
  across.addColorStop(0.65, "rgba(255,255,255,1)");
  across.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, 32, 64);
  // Taper both ends of the streak so a mark fades in and out along the track.
  ctx.globalCompositeOperation = "destination-in";
  const along = ctx.createLinearGradient(0, 0, 0, 64);
  along.addColorStop(0.0, "rgba(0,0,0,0)");
  along.addColorStop(0.3, "rgba(0,0,0,1)");
  along.addColorStop(0.7, "rgba(0,0,0,1)");
  along.addColorStop(1.0, "rgba(0,0,0,0)");
  ctx.fillStyle = along;
  ctx.fillRect(0, 0, 32, 64);
  markTexture = new CanvasTexture(canvas);
  return markTexture;
}

let shadowGeometry: PlaneGeometry | null = null;
function getShadowGeometry(): PlaneGeometry {
  if (!shadowGeometry) shadowGeometry = new PlaneGeometry(1, 1);
  return shadowGeometry;
}

let markGeometry: PlaneGeometry | null = null;
function getMarkGeometry(): PlaneGeometry {
  if (!markGeometry) markGeometry = new PlaneGeometry(1, 1);
  return markGeometry;
}

/** Orientation that lays a plane flat on the track, facing up. */
const FLAT_QUATERNION = new Quaternion().setFromAxisAngle(
  new Vector3(1, 0, 0),
  -Math.PI / 2
);

// Scratch objects reused every frame — allocating inside useFrame is what
// turns six cars into a garbage-collection stutter.
const scratchObject = new Object3D();
scratchObject.rotation.order = "YXZ";
const scratchColor = new Color();
const scratchQuaternion = new Quaternion();

// ============================================================================
// Deterministic per-car variation
// ============================================================================

function hashCarId(carId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < carId.length; i++) {
    hash ^= carId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Small, cheap PRNG. Seeded per car so a replay always looks identical. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface CarSetup {
  /** Chassis trim: no two cars sit or react exactly the same. */
  pitchGain: number;
  rollGain: number;
  yawTrim: number;
  rideTrim: number;
  roadPhase: number;
  roadFrequency: number;
  idlePhase: number;
  storePhase: number;
  random: () => number;
}

function buildCarSetup(carId: string): CarSetup {
  const seed = hashCarId(carId);
  const rand = mulberry32(seed);
  return {
    pitchGain: 0.85 + rand() * 0.35,
    rollGain: 0.85 + rand() * 0.35,
    yawTrim: (rand() - 0.5) * 0.03,
    rideTrim: rand() * 0.006,
    roadPhase: rand() * Math.PI * 2,
    roadFrequency: 0.55 + rand() * 0.25,
    idlePhase: rand() * Math.PI * 2,
    storePhase: rand() * STORE_UPDATE_INTERVAL,
    random: rand,
  };
}

interface RacingCarProps {
  participant: RaceParticipant;
  predeterminedPosition: number;
  totalParticipants: number;
  isUserCar: boolean;
  isRacing: boolean;
  rubberBandStrength: number;
  excitementFactor: number;
}

/**
 * Individual racing car: track position, weight transfer, and everything that
 * ties the car to the asphalt (contact shadow, tyre dust, tyre marks).
 */
function RacingCar({
  participant,
  predeterminedPosition,
  totalParticipants,
  isUserCar,
  isRacing,
  rubberBandStrength,
  excitementFactor,
}: RacingCarProps) {
  const carGroupRef = useRef<Group>(null);
  const shadowRef = useRef<Group>(null);
  const dustRef = useRef<Points>(null);
  const marksRef = useRef<InstancedMesh>(null);
  const exhaustRef = useRef<CarExhaustHandle>(null);
  const updateProgress = useRaceStore((state) => state.updateProgress);

  const setup = useMemo(
    () => buildCarSetup(participant.car.id),
    [participant.car.id]
  );

  // --- Race simulation state (refs: the car must not re-render per frame) ---
  const progressRef = useRef(0);
  const currentSpeedRef = useRef(0);
  const previousSpeedRef = useRef(0);
  const longitudinalAccelRef = useRef(0);
  const lateralOffsetRef = useRef(0);
  const previousLateralRef = useRef(0);
  const lateralVelocityRef = useRef(0);
  const pitchRef = useRef(0);
  const rollRef = useRef(0);
  const yawRef = useRef(0);
  const currentYRef = useRef(GROUND_Y + RIDE_HEIGHT);
  const velocityYRef = useRef(0);
  const travelledRef = useRef(0);
  const previousZRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);
  const boostStateRef = useRef<AIBoostState>(
    initializeAIBoostState(participant.car.id)
  );
  const laneDriftRef = useRef(0);
  const storeTimerRef = useRef(setup.storePhase);

  // --- Ground effect pools ---
  const dust = useMemo(() => {
    const positions = new Float32Array(DUST_POOL * 3);
    const colors = new Float32Array(DUST_POOL * 3);
    const positionAttribute = new BufferAttribute(positions, 3);
    const colorAttribute = new BufferAttribute(colors, 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", positionAttribute);
    geometry.setAttribute("color", colorAttribute);
    const material = new PointsMaterial({
      // A 6 m car: anything approaching a metre reads as a floating ball.
      size: 0.4,
      map: getDustTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false,
    });
    return {
      geometry,
      material,
      positionAttribute,
      colorAttribute,
      positions,
      colors,
      velocities: new Float32Array(DUST_POOL * 3),
      life: new Float32Array(DUST_POOL),
      maxLife: new Float32Array(DUST_POOL),
      cursor: { value: 0, accumulator: 0 },
    };
  }, []);

  const markMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        map: getMarkTexture(),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    []
  );

  const markState = useMemo(
    () => ({
      life: new Float32Array(MARK_POOL),
      cursor: 0,
      sinceLast: 0,
    }),
    []
  );

  const shadowMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        map: getShadowTexture(),
        color: "#000000",
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        toneMapped: false,
      }),
    []
  );

  // Yaw is heading; pitch and roll are body attitude relative to that heading.
  // The default XYZ order would apply them the other way round.
  useEffect(() => {
    if (carGroupRef.current) carGroupRef.current.rotation.order = "YXZ";
  }, []);

  useEffect(() => {
    return () => {
      dust.geometry.dispose();
      dust.material.dispose();
      markMaterial.dispose();
      shadowMaterial.dispose();
    };
  }, [dust, markMaterial, shadowMaterial]);

  // instanceColor only exists once setColorAt has run, so seed the pool empty.
  useEffect(() => {
    const marks = marksRef.current;
    if (!marks) return;
    scratchObject.position.set(0, MARK_Y, 0);
    scratchObject.rotation.set(-Math.PI / 2, 0, 0);
    scratchObject.scale.set(0, 0, 0);
    scratchObject.updateMatrix();
    for (let i = 0; i < MARK_POOL; i++) {
      marks.setMatrixAt(i, scratchObject.matrix);
      marks.setColorAt(i, scratchColor.setRGB(0, 0, 0));
      markState.life[i] = 0;
    }
    marks.instanceMatrix.needsUpdate = true;
    if (marks.instanceColor) marks.instanceColor.needsUpdate = true;
  }, [markState]);

  /**
   * Ages the dust and mark pools and, while the car is moving, feeds them.
   * `worldX` / `worldZ` are the car's contact-patch centre this frame.
   */
  function updateGroundEffects(
    dt: number,
    speedFactor: number,
    boosting: boolean,
    boostIntensity: number,
    worldX: number,
    worldZ: number,
    distanceStep: number
  ) {
    // --- Dust ---
    const spawnRate = boosting
      ? 14 + speedFactor * 18
      : speedFactor > 0.18
      ? speedFactor * 22
      : 0;
    dust.cursor.accumulator += spawnRate * dt;

    while (dust.cursor.accumulator >= 1) {
      dust.cursor.accumulator -= 1;
      const index = dust.cursor.value;
      dust.cursor.value = (index + 1) % DUST_POOL;
      const side = index % 2 === 0 ? 1 : -1;
      const r = setup.random;
      const base = index * 3;
      dust.positions[base] = worldX + side * REAR_TRACK_HALF + (r() - 0.5) * 0.25;
      dust.positions[base + 1] = 0.05 + r() * 0.06;
      dust.positions[base + 2] = worldZ + REAR_AXLE_Z + (r() - 0.5) * 0.3;
      dust.velocities[base] = side * (0.25 + r() * 0.5);
      dust.velocities[base + 1] = 0.3 + speedFactor * 0.5 + r() * 0.2;
      dust.velocities[base + 2] = -(1.2 + speedFactor * 4.5 + r());
      const life = 0.45 + r() * 0.3;
      dust.life[index] = life;
      dust.maxLife[index] = life;
    }

    const boostTint = boosting ? boostIntensity : 0;
    let dustDirty = false;
    for (let i = 0; i < DUST_POOL; i++) {
      if (dust.life[i] <= 0) continue;
      dustDirty = true;
      dust.life[i] -= dt;
      const base = i * 3;
      if (dust.life[i] <= 0) {
        // Additive blending: black is invisible, so a dead particle just goes dark.
        dust.colors[base] = 0;
        dust.colors[base + 1] = 0;
        dust.colors[base + 2] = 0;
        continue;
      }
      const drag = Math.min(1, 2.6 * dt);
      dust.velocities[base] -= dust.velocities[base] * drag;
      dust.velocities[base + 1] -= dust.velocities[base + 1] * drag;
      dust.velocities[base + 2] -= dust.velocities[base + 2] * drag;
      dust.positions[base] += dust.velocities[base] * dt;
      dust.positions[base + 1] += dust.velocities[base + 1] * dt;
      dust.positions[base + 2] += dust.velocities[base + 2] * dt;

      const t = dust.life[i] / dust.maxLife[i];
      const fade = t * t * (0.3 + speedFactor * 0.35);
      // Neutral grey smoke, tinted to the brand accent only under boost.
      dust.colors[base] = fade * (1 - boostTint);
      dust.colors[base + 1] = fade * (1 - boostTint * 0.18);
      dust.colors[base + 2] = fade;
    }

    if (dustDirty) {
      dust.positionAttribute.needsUpdate = true;
      dust.colorAttribute.needsUpdate = true;
    }

    // --- Tyre marks ---
    const marks = marksRef.current;
    if (!marks) return;

    markState.sinceLast += distanceStep;
    if (speedFactor > 0.25 && markState.sinceLast >= MARK_SPACING) {
      markState.sinceLast = 0;
      const intensity = boosting ? 1 : MathUtils.clamp(speedFactor, 0, 1);
      for (let side = -1; side <= 1; side += 2) {
        const index = markState.cursor;
        markState.cursor = (markState.cursor + 1) % MARK_POOL;
        markState.life[index] = MARK_LIFETIME;
        scratchObject.position.set(
          worldX + side * REAR_TRACK_HALF,
          MARK_Y,
          worldZ + REAR_AXLE_Z
        );
        scratchObject.rotation.set(-Math.PI / 2, yawRef.current, 0);
        scratchObject.scale.set(
          MARK_WIDTH,
          MARK_LENGTH * (0.6 + intensity * 0.6),
          1
        );
        scratchObject.updateMatrix();
        marks.setMatrixAt(index, scratchObject.matrix);
      }
      marks.instanceMatrix.needsUpdate = true;
    }

    let marksDirty = false;
    for (let i = 0; i < MARK_POOL; i++) {
      if (markState.life[i] <= 0) continue;
      marksDirty = true;
      markState.life[i] = Math.max(0, markState.life[i] - dt);
      const t = markState.life[i] / MARK_LIFETIME;
      const value = t * t * 0.32;
      marks.setColorAt(i, scratchColor.setRGB(value, value, value));
    }
    if (marksDirty && marks.instanceColor) {
      marks.instanceColor.needsUpdate = true;
    }
  }

  /** Keeps the contact shadow flat on the track no matter how the body moves. */
  function updateShadow(bodyY: number, speedFactor: number) {
    const shadow = shadowRef.current;
    const car = carGroupRef.current;
    if (!shadow || !car) return;

    // World orientation must stay flat: local = parent^-1 * flat.
    scratchQuaternion.copy(car.quaternion).invert();
    shadow.quaternion.copy(scratchQuaternion).multiply(FLAT_QUATERNION);
    shadow.position.set(0, SHADOW_Y - bodyY, 0);

    // Higher body = softer, wider shadow. This is the cue that reads as contact.
    const lift = MathUtils.clamp((bodyY - GROUND_Y) / 0.12, 0, 1);
    shadow.scale.set(
      CAR_HALF_WIDTH * 2.3 * (1 + lift * 0.12),
      CAR_LENGTH * 1.12 * (1 + speedFactor * 0.05),
      1
    );
    shadowMaterial.opacity = 0.6 - lift * 0.22;
  }

  useFrame((state, delta) => {
    const car = carGroupRef.current;
    if (!car) return;

    // A tab that was backgrounded returns with a huge delta; clamping keeps
    // the spring and the particle pools from exploding on the first frame back.
    const dt = Math.min(delta, 1 / 30);

    if (!isRacing) {
      // On the grid: stationary, but alive. Engine vibration through the
      // chassis and a held brake, not a rigid prop.
      const t = state.clock.elapsedTime;
      const startPos = getTrackPosition(0, participant.laneIndex);
      const idle =
        Math.sin(t * 26 + setup.idlePhase) * 0.004 +
        Math.sin(t * 41.3 + setup.idlePhase * 1.7) * 0.0022;
      const bodyY = GROUND_Y + RIDE_HEIGHT + setup.rideTrim + idle;

      car.position.set(startPos.x, bodyY, startPos.z);
      car.rotation.set(
        idle * 0.35,
        setup.yawTrim,
        Math.sin(t * 18.5 + setup.idlePhase) * 0.0015
      );

      pitchRef.current = 0;
      rollRef.current = 0;
      yawRef.current = setup.yawTrim;
      currentYRef.current = bodyY;
      previousZRef.current = startPos.z;

      // Idle exhaust shimmer; no boost while the lights are still on.
      exhaustRef.current?.setState(0.08, false, 0);
      updateShadow(bodyY, 0);
      updateGroundEffects(dt, 0, false, 0, startPos.x, startPos.z, 0);
      return;
    }

    if (startTimeRef.current === null) {
      startTimeRef.current = state.clock.elapsedTime;
    }

    const raceTime = state.clock.elapsedTime - startTimeRef.current;

    // Calculate overall race progress (0-1 over race duration)
    const raceDuration = 30; // 30 seconds for full race
    const raceProgress = Math.min(1, raceTime / raceDuration);

    // Calculate target progress for this car based on predetermined position
    const targetProgress = calculateTargetProgress(
      participant,
      predeterminedPosition,
      totalParticipants,
      raceProgress,
      rubberBandStrength,
      excitementFactor
    );

    // Smooth interpolation toward target (creates rubber-banding effect)
    const smoothingFactor =
      0.02 + (participant.stats.acceleration / 100) * 0.03;
    progressRef.current = MathUtils.lerp(
      progressRef.current,
      targetProgress,
      smoothingFactor
    );

    // Update boost state for AI-controlled feel
    const currentVisualPosition = predeterminedPosition;
    boostStateRef.current = updateAIBoostState(
      boostStateRef.current,
      raceTime,
      dt,
      predeterminedPosition,
      currentVisualPosition,
      raceProgress
    );

    // Calculate current speed with acceleration curve and boost
    const isCorner = isAtCorner(progressRef.current);
    const visualSpeed = calculateSpeedVariation(
      participant.stats.speed,
      progressRef.current,
      isCorner,
      participant.stats.handling,
      participant.stats.acceleration,
      raceTime,
      boostStateRef.current
    );

    // ---- Longitudinal acceleration, from the frame-to-frame speed delta ----
    const rawLongitudinalAccel =
      (visualSpeed - previousSpeedRef.current) / Math.max(dt, 1e-4);
    previousSpeedRef.current = visualSpeed;
    currentSpeedRef.current = visualSpeed;
    longitudinalAccelRef.current = MathUtils.damp(
      longitudinalAccelRef.current,
      rawLongitudinalAccel,
      7,
      dt
    );
    const accelSignal = MathUtils.clamp(
      longitudinalAccelRef.current / LONGITUDINAL_ACCEL_REFERENCE,
      -1,
      1
    );

    // ---- Racing line. The seeded lane drift IS the steering input; the old
    // unmotivated sine weave is gone, and the drift now also drives roll/yaw.
    const targetLaneDrift = calculateLaneDrift(
      participant.laneIndex,
      raceTime,
      participant.car.id,
      raceProgress
    );
    laneDriftRef.current = MathUtils.damp(
      laneDriftRef.current,
      targetLaneDrift,
      2,
      dt
    );
    previousLateralRef.current = lateralOffsetRef.current;
    lateralOffsetRef.current = MathUtils.damp(
      lateralOffsetRef.current,
      laneDriftRef.current,
      3,
      dt
    );

    // ---- Lateral velocity, from the frame-to-frame offset delta ----
    const rawLateralVelocity =
      (lateralOffsetRef.current - previousLateralRef.current) / Math.max(dt, 1e-4);
    lateralVelocityRef.current = MathUtils.damp(
      lateralVelocityRef.current,
      rawLateralVelocity,
      8,
      dt
    );
    const lateralSignal = MathUtils.clamp(
      lateralVelocityRef.current / LATERAL_VELOCITY_REFERENCE,
      -1,
      1
    );

    const trackPosition = getTrackPosition(
      Math.min(progressRef.current, 1),
      participant.laneIndex
    );
    const trackRotation = getTrackRotation(progressRef.current);

    const worldX = trackPosition.x + lateralOffsetRef.current;
    const worldZ = trackPosition.z;
    const distanceStep = Math.max(0, worldZ - previousZRef.current);
    previousZRef.current = worldZ;
    travelledRef.current += distanceStep;

    const speedFactor = MathUtils.clamp(visualSpeed / TOP_SPEED_REFERENCE, 0, 1);

    // ---- Weight transfer -----------------------------------------------------
    // Squat under power (nose rises), dive under lift-off (nose drops).
    // Positive rotation.x pitches the nose DOWN, hence the negation.
    const targetPitch = -accelSignal * MAX_PITCH * setup.pitchGain;
    // Lean away from the direction of travel: sliding toward +X drops the -X
    // side, which is a positive rotation about Z.
    const targetRoll = lateralSignal * MAX_ROLL * setup.rollGain;
    // Point the car where it is actually going instead of sliding on rails.
    const targetYaw = trackRotation + setup.yawTrim + lateralSignal * MAX_YAW;

    pitchRef.current = MathUtils.damp(pitchRef.current, targetPitch, 9, dt);
    rollRef.current = MathUtils.damp(rollRef.current, targetRoll, 7, dt);
    yawRef.current = MathUtils.damp(yawRef.current, targetYaw, 6, dt);

    // ---- Suspension ---------------------------------------------------------
    // Road input is a function of distance travelled, not of wall-clock time,
    // so the body stops shaking exactly when the car stops moving.
    const roadInput =
      Math.sin(travelledRef.current * setup.roadFrequency + setup.roadPhase) *
        0.6 +
      Math.sin(
        travelledRef.current * setup.roadFrequency * 2.37 + setup.roadPhase * 1.7
      ) *
        0.4;
    // Acceleration also compresses the springs, not just tilts the body.
    const heave = roadInput * SUSPENSION_TRAVEL * speedFactor -
      accelSignal * SUSPENSION_TRAVEL * 0.25;
    const suspensionTarget = GROUND_Y + RIDE_HEIGHT + setup.rideTrim + heave;

    velocityYRef.current +=
      (suspensionTarget - currentYRef.current) * SUSPENSION_STIFFNESS * dt;
    velocityYRef.current -=
      velocityYRef.current * Math.min(1, SUSPENSION_DAMPING * dt);
    currentYRef.current += velocityYRef.current * dt;

    // A body rotated about its contact plane dips at the nose and at the
    // outside edge. Lifting by exactly that much is the cheapest guarantee the
    // car can never intersect the asphalt, and it costs a couple of centimetres.
    const bodyDip =
      Math.abs(pitchRef.current) * CAR_HALF_LENGTH +
      Math.abs(rollRef.current) * CAR_HALF_WIDTH;
    const floor = GROUND_Y + bodyDip;
    let finalY = currentYRef.current;
    if (finalY < floor) {
      finalY = floor;
      currentYRef.current = floor;
      if (velocityYRef.current < 0) velocityYRef.current = 0;
    }

    car.position.set(worldX, finalY, worldZ);
    car.rotation.set(pitchRef.current, yawRef.current, rollRef.current);

    // ---- Thruster, driven imperatively so the car never re-renders ----------
    exhaustRef.current?.setState(
      speedFactor,
      boostStateRef.current.active,
      boostStateRef.current.intensity
    );

    updateShadow(finalY, speedFactor);
    updateGroundEffects(
      dt,
      speedFactor,
      boostStateRef.current.active,
      boostStateRef.current.intensity,
      worldX,
      worldZ,
      distanceStep
    );

    // ---- Store feed: deterministic ~10 Hz, phase-offset per car so the six
    // cars never all write on the same frame. The camera reads this.
    storeTimerRef.current += dt;
    if (storeTimerRef.current >= STORE_UPDATE_INTERVAL) {
      storeTimerRef.current -= STORE_UPDATE_INTERVAL;
      updateProgress(
        participant.car.id,
        progressRef.current,
        currentSpeedRef.current
      );
    }
  });

  // Reset everything when the race resets
  useEffect(() => {
    if (isRacing || !carGroupRef.current) return;

    progressRef.current = 0;
    startTimeRef.current = null;
    currentSpeedRef.current = 0;
    previousSpeedRef.current = 0;
    longitudinalAccelRef.current = 0;
    lateralOffsetRef.current = 0;
    previousLateralRef.current = 0;
    lateralVelocityRef.current = 0;
    pitchRef.current = 0;
    rollRef.current = 0;
    yawRef.current = setup.yawTrim;
    currentYRef.current = GROUND_Y + RIDE_HEIGHT + setup.rideTrim;
    velocityYRef.current = 0;
    travelledRef.current = 0;
    laneDriftRef.current = 0;
    storeTimerRef.current = setup.storePhase;
    boostStateRef.current = initializeAIBoostState(participant.car.id);

    dust.life.fill(0);
    dust.colors.fill(0);
    dust.cursor.accumulator = 0;
    dust.colorAttribute.needsUpdate = true;
    markState.life.fill(0);
    markState.sinceLast = 0;

    const startPosition = getTrackPosition(0, participant.laneIndex);
    previousZRef.current = startPosition.z;
    carGroupRef.current.position.set(
      startPosition.x,
      currentYRef.current,
      startPosition.z
    );
    carGroupRef.current.rotation.set(0, setup.yawTrim, 0);
  }, [isRacing, participant.laneIndex, participant.car.id, setup, dust, markState]);

  return (
    <>
      <group ref={carGroupRef}>
        {/*
          No `isSelected` — that flag drives Car3D's showroom idle yaw, which
          would fight the rotation this component writes on the parent group.
        */}
        <Car3D tokenId={participant.car.tokenId} position={[0, 0, 0]} />

        {/* Contact shadow: counter-rotated every frame so it stays on the deck. */}
        <group ref={shadowRef}>
          <mesh
            geometry={getShadowGeometry()}
            material={shadowMaterial}
            renderOrder={-1}
          />
        </group>

        {/* Thruster. Owned by the effects agent, driven imperatively above. */}
        <CarExhaust ref={exhaustRef} offset={[0, 0.42, -CAR_HALF_LENGTH + 0.15]} />

        {/* Brake lights: held on the grid, released when the race starts. */}
        {!isRacing && (
          <>
            <mesh position={[0.75, 0.55, REAR_AXLE_Z - 0.85]}>
              <boxGeometry args={[0.45, 0.08, 0.02]} />
              <meshBasicMaterial color="#ffffff" toneMapped={false} />
            </mesh>
            <mesh position={[-0.75, 0.55, REAR_AXLE_Z - 0.85]}>
              <boxGeometry args={[0.45, 0.08, 0.02]} />
              <meshBasicMaterial color="#ffffff" toneMapped={false} />
            </mesh>
          </>
        )}

        {/* Underglow marks the player's car. */}
        {isUserCar && (
          <pointLight
            position={[0, 0.2, 0]}
            intensity={3}
            distance={4}
            color={BRAND_ACCENT}
          />
        )}
      </group>

      {/*
        Ground effects live in world space, outside the car group — dust and
        tyre marks are left behind on the track, they do not travel with the car.
      */}
      <points
        ref={dustRef}
        geometry={dust.geometry}
        material={dust.material}
        frustumCulled={false}
      />
      <instancedMesh
        ref={marksRef}
        args={[getMarkGeometry(), markMaterial, MARK_POOL]}
        frustumCulled={false}
      />
    </>
  );
}

interface RaceDirectorProps {
  onRaceComplete?: () => void;
}

/**
 * Main RaceDirector component - orchestrates the entire race
 */
export function RaceDirector({ onRaceComplete }: RaceDirectorProps) {
  const {
    raceState,
    participants,
    userCarId,
    countdown,
    config,
    predeterminedPositions,
    setCountdown,
    startRace,
    finishRace,
    updatePositions,
    setElapsedTime,
  } = useRaceStore();

  const raceStartTimeRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Handle countdown
  useEffect(() => {
    if (raceState === "COUNTDOWN" && countdown > 0) {
      countdownIntervalRef.current = setInterval(() => {
        setCountdown(countdown - 1);
      }, 1000);

      return () => {
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
        }
      };
    }

    if (raceState === "COUNTDOWN" && countdown === 0) {
      // GO!
      setTimeout(() => {
        startRace();
        raceStartTimeRef.current = Date.now();
      }, 500);
    }
  }, [raceState, countdown, setCountdown, startRace]);

  // Main race loop - update positions and check for finish
  useFrame(() => {
    if (raceState !== "RACING") return;

    // Update elapsed time
    if (raceStartTimeRef.current) {
      const elapsed = (Date.now() - raceStartTimeRef.current) / 1000;
      setElapsedTime(elapsed);

      // Update position rankings
      updatePositions();

      // Check if race is finished (leader at 100%)
      const leader = participants.reduce((prev, curr) =>
        curr.progress > prev.progress ? curr : prev
      );

      if (leader.progress >= 0.99) {
        // Race finished!
        const sortedByPosition = [...participants].sort((a, b) => {
          const posA = predeterminedPositions.indexOf(a.car.id);
          const posB = predeterminedPositions.indexOf(b.car.id);
          return posA - posB;
        });

        const winner = sortedByPosition[0];

        finishRace({
          winner,
          positions: sortedByPosition,
          prizePool: config.prizePool,
          payouts: sortedByPosition.map((p, i) => ({
            participantId: p.car.id,
            amount: Math.floor(config.prizePool * [0.5, 0.3, 0.15, 0.05][i]),
            position: i + 1,
          })),
        });

        onRaceComplete?.();
      }
    }
  });

  return (
    <group>
      {/* Race Track */}
      <RaceTrack showPath={true} showBarriers={true} />

      {/* Racing Cars */}
      <Suspense fallback={null}>
        {participants.map((participant) => {
          const predeterminedPosition =
            predeterminedPositions.indexOf(participant.car.id) + 1;

          return (
            <RacingCar
              key={participant.car.id}
              participant={participant}
              predeterminedPosition={predeterminedPosition}
              totalParticipants={participants.length}
              isUserCar={participant.car.id === userCarId}
              isRacing={raceState === "RACING"}
              rubberBandStrength={config.rubberBandStrength}
              excitementFactor={config.excitementFactor}
            />
          );
        })}
      </Suspense>

      {/*
        The countdown is a DOM overlay in RaceUI. There is deliberately no 3D
        traffic-light sphere here — the design system rules out cartoon indicators.
      */}

      {/* Finish line lighting - single brand accent, no confetti palette. */}
      {raceState === "FINISHED" && (
        <group position={[0, 5, TRACK_CONFIG.totalDistance]}>
          <pointLight intensity={100} color={BRAND_ACCENT} distance={30} />
          <pointLight
            position={[0, -4, -6]}
            intensity={40}
            color="#ffffff"
            distance={24}
          />
        </group>
      )}
    </group>
  );
}

export default RaceDirector;
