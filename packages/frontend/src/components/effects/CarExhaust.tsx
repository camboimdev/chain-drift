import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PlaneGeometry,
  PointLight,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from "three";

/**
 * Imperative handle used by the car controller.
 *
 * The plume is driven from the parent `useFrame` at 60fps: pushing those values
 * through React state would re-render the whole car every frame, so the values
 * are parked in refs here and consumed by this component's own `useFrame`.
 */
export interface CarExhaustHandle {
  /**
   * @param speedFactor    normalised speed, 0..1
   * @param boosting       whether the boost is currently active
   * @param boostIntensity boost strength, 0..1
   */
  setState(speedFactor: number, boosting: boolean, boostIntensity: number): void;
}

/* -------------------------------------------------------------------------- */
/* Brand palette                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Chain Drift is monochrome-first with a single accent (#00D1FF).
 * The plume ramps white-hot core -> electric blue -> dark falloff.
 * Values above 1 are intentional: the materials are unlit and untonemapped, so
 * the extra headroom is what the scene Bloom picks up as heat.
 */
const CORE_COLOR = new Color(1.0, 1.0, 1.0);
const ACCENT_COLOR = new Color("#00D1FF");
const FALLOFF_COLOR = new Color("#0A3E52");

/* -------------------------------------------------------------------------- */
/* Shared GPU resources                                                       */
/* -------------------------------------------------------------------------- */

interface SharedResources {
  beamGeometry: PlaneGeometry;
  discGeometry: PlaneGeometry;
  plumeTexture: CanvasTexture;
  radialTexture: CanvasTexture;
}

/**
 * Soft radial falloff, used for the nozzle core and the shock diamonds.
 * Pure white with a shaped alpha so every instance can tint it freely.
 */
function createRadialTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
  gradient.addColorStop(0.0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.18, "rgba(255,255,255,0.72)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.22)");
  gradient.addColorStop(0.75, "rgba(255,255,255,0.05)");
  gradient.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

/**
 * Tapered plume mask. `v = 1` is the nozzle (top row of the canvas), `v = 0`
 * is the tip. The nozzle is narrow, the plume bulges just behind it and then
 * tapers away, which is what separates a thruster from a cone.
 */
function createPlumeTexture(): CanvasTexture {
  const width = 64;
  const height = 256;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(width, height);
  const data = image.data;

  for (let y = 0; y < height; y++) {
    // 0 at the nozzle, 1 at the tip.
    const s = y / (height - 1);
    // Narrow throat, bulge at ~25% of the length, long taper to the tip.
    const radius = 0.1 + 0.4 * Math.sin(Math.pow(s, 0.55) * Math.PI * 0.94);
    // Longitudinal energy: hottest at the throat, quickly bleeding off.
    const longitudinal = Math.pow(1 - s, 1.7);

    for (let x = 0; x < width; x++) {
      const dx = (x / (width - 1) - 0.5) * 2;
      const radial = Math.max(0, 1 - (dx / radius) * (dx / radius));
      const alpha = longitudinal * radial * radial;

      const i = (y * width + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(Math.min(1, alpha) * 255);
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

let sharedResources: SharedResources | null = null;

/**
 * Geometry and textures are identical for every car, so they are built once and
 * shared by all instances. They live for the lifetime of the page on purpose:
 * disposing them when a single car unmounts would tear the plume out from under
 * the cars still racing.
 */
function getSharedResources(): SharedResources {
  if (!sharedResources) {
    // Quad spanning y = [-1, 0]; rotated +90deg about X it spans z = [-1, 0],
    // so the plume grows from the nozzle toward -Z. uv.v = 1 is the nozzle.
    const beamGeometry = new PlaneGeometry(1, 1).translate(0, -0.5, 0);
    sharedResources = {
      beamGeometry,
      discGeometry: new PlaneGeometry(1, 1),
      plumeTexture: createPlumeTexture(),
      radialTexture: createRadialTexture(),
    };
  }
  return sharedResources;
}

/* -------------------------------------------------------------------------- */
/* Heat haze shader                                                           */
/* -------------------------------------------------------------------------- */

const HAZE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Domain-warped fbm on a transparent quad. A real refraction pass would cost a
 * scene render per car, which the race cannot afford; this reads as the same
 * rippling hot air for the price of one alpha-blended quad.
 */
const HAZE_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uStrength;
  uniform float uSeed;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p *= 2.03;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec2 centered = vUv - 0.5;
    float mask = 1.0 - smoothstep(0.06, 0.5, length(centered));
    vec2 q = vec2(centered.x * 3.4, centered.y * 2.2 - uTime * 0.85 + uSeed);
    float warped = fbm(q + fbm(q * 1.7 + uSeed) * 0.65);
    float shimmer = smoothstep(0.40, 0.80, warped);
    float alpha = mask * shimmer * uStrength;
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(vec3(0.70, 0.79, 0.85), alpha);
  }
`;

/* -------------------------------------------------------------------------- */
/* Deterministic noise                                                        */
/* -------------------------------------------------------------------------- */

function hash1(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth 1D value noise in 0..1. */
function valueNoise(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash1(i) * (1 - u) + hash1(i + 1) * u;
}

/**
 * Three octaves of value noise, sampled off elapsed time plus a per-instance
 * seed. Sampling time (never `Math.random()` per frame) keeps the flicker
 * identical at any frame rate instead of strobing as white noise.
 */
function fbm1(x: number): number {
  return (
    valueNoise(x) * 0.55 +
    valueNoise(x * 2.13 + 7.3) * 0.3 +
    valueNoise(x * 4.31 + 19.1) * 0.15
  );
}

/** Frame-rate independent exponential smoothing. */
function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/* -------------------------------------------------------------------------- */
/* Plume layout                                                               */
/* -------------------------------------------------------------------------- */

/** World length of the plume at full speed, before the boost multiplier. */
const BASE_LENGTH = 2.4;
/** World radius of the plume at full speed. */
const BASE_WIDTH = 0.62;

interface BeamLayerConfig {
  color: Color;
  /** HDR gain; > 1 pushes the layer past the Bloom threshold. */
  gain: number;
  widthScale: number;
  lengthScale: number;
  /** Phase offset so the layers never flicker in lockstep. */
  phase: number;
  flicker: number;
  /** How far this layer licks sideways with the turbulence. */
  lick: number;
}

/**
 * Three stacked beams. Because they are additive and get progressively longer
 * and dimmer, they sum into a single continuous ramp along the plume:
 * white-hot at the throat, accent through the body, dark at the tip.
 */
const BEAM_LAYERS: readonly BeamLayerConfig[] = [
  { color: CORE_COLOR, gain: 3.4, widthScale: 0.34, lengthScale: 0.46, phase: 0.0, flicker: 0.14, lick: 0.02 },
  { color: ACCENT_COLOR, gain: 1.55, widthScale: 0.66, lengthScale: 1.0, phase: 3.7, flicker: 0.2, lick: 0.05 },
  { color: FALLOFF_COLOR, gain: 0.85, widthScale: 1.0, lengthScale: 1.75, phase: 8.1, flicker: 0.28, lick: 0.09 },
];

/** Positions of the shock diamonds along the core, as a fraction of length. */
const SHOCK_DIAMONDS = [0.2, 0.38, 0.58] as const;

const DEFAULT_OFFSET: [number, number, number] = [0, 0.55, -2.7];

/* Frame-loop scratch objects. Allocating a Vector3 per car per frame is exactly
 * the kind of garbage that shows up as stutter, so these are reused. */
const scratchCameraLocal = new Vector3();
const scratchQuaternion = new Quaternion();
const scratchParentQuaternion = new Quaternion();

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export const CarExhaust = forwardRef<
  CarExhaustHandle,
  { offset?: [number, number, number] }
>(function CarExhaust({ offset = DEFAULT_OFFSET }, ref) {
  const shared = getSharedResources();

  const rootRef = useRef<Group>(null);
  const rollRef = useRef<Group>(null);
  const beamRefs = useRef<(Mesh | null)[]>([]);
  const coreRefs = useRef<(Mesh | null)[]>([]);
  const shockRefs = useRef<(Mesh | null)[]>([]);
  const hazeRef = useRef<Mesh>(null);
  const lightRef = useRef<PointLight>(null);

  /** Values pushed in by the parent every frame. Never React state. */
  const input = useRef({ speedFactor: 0, boosting: false, boostIntensity: 0 });
  /** Smoothed values actually rendered, plus the boost leading-edge flare. */
  const smoothed = useRef({ speed: 0, boost: 0, flare: 0, wasBoosting: false });

  const seed = useMemo(() => Math.random() * 100, []);

  useImperativeHandle(
    ref,
    () => ({
      setState(speedFactor: number, boosting: boolean, boostIntensity: number) {
        const state = input.current;
        state.speedFactor = speedFactor;
        state.boosting = boosting;
        state.boostIntensity = boostIntensity;
      },
    }),
    []
  );

  // One material per layer per car: they are mutated every frame, so they
  // cannot be shared between instances the way the geometry and textures are.
  const beamMaterials = useMemo(
    () =>
      BEAM_LAYERS.map(
        (layer) =>
          new MeshBasicMaterial({
            map: shared.plumeTexture,
            color: layer.color.clone(),
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: AdditiveBlending,
            toneMapped: false,
          })
      ),
    [shared]
  );

  const coreMaterials = useMemo(
    () =>
      [CORE_COLOR, ACCENT_COLOR].map(
        (color) =>
          new MeshBasicMaterial({
            map: shared.radialTexture,
            color: color.clone(),
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: AdditiveBlending,
            toneMapped: false,
          })
      ),
    [shared]
  );

  const shockMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        map: shared.radialTexture,
        color: CORE_COLOR.clone(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [shared]
  );

  const hazeMaterial = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: HAZE_VERTEX,
        fragmentShader: HAZE_FRAGMENT,
        uniforms: {
          uTime: { value: 0 },
          uStrength: { value: 0 },
          uSeed: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: NormalBlending,
      }),
    []
  );

  useEffect(() => {
    hazeMaterial.uniforms.uSeed.value = seed;
  }, [hazeMaterial, seed]);

  // Dispose only what this instance owns; shared resources outlive it.
  useEffect(
    () => () => {
      beamMaterials.forEach((material) => material.dispose());
      coreMaterials.forEach((material) => material.dispose());
      shockMaterial.dispose();
      hazeMaterial.dispose();
    },
    [beamMaterials, coreMaterials, shockMaterial, hazeMaterial]
  );

  useFrame((state, rawDelta) => {
    const root = rootRef.current;
    if (!root) return;

    const dt = Math.min(rawDelta, 0.05);
    const time = state.clock.elapsedTime;
    const target = input.current;
    const current = smoothed.current;

    /* --- state smoothing ------------------------------------------------- */

    // Everything is damped, so the plume grows and fades continuously instead
    // of popping in at a speed threshold.
    current.speed = damp(current.speed, Math.max(0, Math.min(1, target.speedFactor)), 9, dt);
    const boostTarget = target.boosting
      ? Math.max(0, Math.min(1, target.boostIntensity))
      : 0;
    current.boost = damp(current.boost, boostTarget, target.boosting ? 16 : 6, dt);

    // Leading edge of the boost: a short flare that decays on its own.
    if (target.boosting && !current.wasBoosting) {
      current.flare = 1;
    }
    current.wasBoosting = target.boosting;
    current.flare = damp(current.flare, 0, 5.5, dt);

    const speed = current.speed;
    const boost = current.boost;
    const flare = current.flare;

    // A parked car has no thruster; just off idle it is already a faint
    // shimmer, and from there the ramp is a curve, not a switch.
    const ignition = Math.min(1, speed * 12);
    const energy = (0.12 + 0.88 * Math.pow(speed, 0.75)) * ignition;
    const plumeLength = BASE_LENGTH * (0.3 + 0.7 * energy) * (1 + 1.05 * boost + 0.45 * flare);
    const plumeWidth = BASE_WIDTH * (0.45 + 0.55 * energy) * (1 + 0.3 * boost + 0.35 * flare);

    if (energy < 0.02 && boost < 0.01) {
      root.visible = false;
      return;
    }
    root.visible = true;

    /* --- axial billboard ------------------------------------------------- */

    // Roll the beam quads about the thrust axis so their normal faces the
    // camera. The camera cuts around the cars constantly and a flat quad seen
    // edge-on would vanish; rolling about Z keeps the plume pointing at -Z.
    const roll = rollRef.current;
    if (roll) {
      root.worldToLocal(scratchCameraLocal.copy(state.camera.position));
      roll.rotation.z = Math.atan2(scratchCameraLocal.x, -scratchCameraLocal.y);
    }

    /* --- plume layers ---------------------------------------------------- */

    for (let i = 0; i < BEAM_LAYERS.length; i++) {
      const mesh = beamRefs.current[i];
      if (!mesh) continue;
      const layer = BEAM_LAYERS[i];

      // Turbulence: two rates per layer so length and width never pulse together.
      const turbulence = fbm1(time * (7 + i * 2.1) + seed + layer.phase) - 0.5;
      const lickNoise = fbm1(time * (3.4 + i * 1.3) + seed * 1.7 + layer.phase) - 0.5;
      const wobble = 1 + turbulence * layer.flicker * (0.35 + 0.65 * energy + 0.5 * boost);

      mesh.scale.set(
        plumeWidth * layer.widthScale * (1 + turbulence * layer.flicker * 0.5),
        plumeLength * layer.lengthScale * wobble,
        1
      );
      // The tail licks sideways; the core stays welded to the nozzle.
      mesh.position.x = lickNoise * layer.lick * plumeLength;

      const material = beamMaterials[i];
      const brightness = layer.gain * (0.35 + 0.65 * energy) * (1 + 1.5 * boost + 1.8 * flare);
      material.color.copy(layer.color).multiplyScalar(brightness);
      material.opacity = Math.min(1, (0.18 + 0.62 * energy) * (1 + 0.55 * boost) * wobble);
    }

    /* --- camera-facing nozzle core --------------------------------------- */

    // Full billboards so the throat never disappears at grazing angles, and
    // counter-rotating so the heat appears to churn rather than spin.
    root.getWorldQuaternion(scratchParentQuaternion).invert();
    scratchQuaternion.copy(state.camera.quaternion).premultiply(scratchParentQuaternion);

    for (let i = 0; i < coreRefs.current.length; i++) {
      const mesh = coreRefs.current[i];
      if (!mesh) continue;
      mesh.quaternion.copy(scratchQuaternion);
      mesh.rotateZ(time * (i === 0 ? 1.6 : -1.1) + seed);

      const pulse = 1 + (fbm1(time * (9 + i * 3) + seed + i * 5.5) - 0.5) * 0.3;
      const size = plumeWidth * (i === 0 ? 0.85 : 1.7) * pulse;
      mesh.scale.set(size, size, 1);
      mesh.position.z = -plumeLength * (i === 0 ? 0.02 : 0.1);

      const material = coreMaterials[i];
      const gain = (i === 0 ? 4.2 : 1.35) * (0.4 + 0.6 * energy) * (1 + 1.8 * boost + 2.2 * flare);
      material.color.copy(i === 0 ? CORE_COLOR : ACCENT_COLOR).multiplyScalar(gain);
      material.opacity = Math.min(1, (0.22 + 0.55 * energy) * pulse);
    }

    /* --- shock diamonds (boost only) ------------------------------------- */

    const shockStrength = boost * boost;
    shockMaterial.opacity = Math.min(1, shockStrength * 0.9);
    shockMaterial.color.copy(CORE_COLOR).multiplyScalar(2.6 + 3.4 * shockStrength + 2 * flare);

    for (let i = 0; i < SHOCK_DIAMONDS.length; i++) {
      const mesh = shockRefs.current[i];
      if (!mesh) continue;
      mesh.visible = shockStrength > 0.01;
      if (!mesh.visible) continue;

      const jitter = (fbm1(time * 5.5 + seed + i * 3.9) - 0.5) * 0.06;
      const spacing = SHOCK_DIAMONDS[i] + jitter;
      mesh.position.z = -plumeLength * spacing;
      // Wide and flat: an anisotropic radial falloff reads as a Mach disk.
      const width = plumeWidth * (0.9 - i * 0.16) * (1 + 0.25 * shockStrength);
      mesh.scale.set(width, width * 0.34, 1);
    }

    /* --- heat haze -------------------------------------------------------- */

    const haze = hazeRef.current;
    if (haze) {
      haze.quaternion.copy(scratchQuaternion);
      const hazeSize = plumeLength * 1.15;
      haze.scale.set(hazeSize * 0.75, hazeSize, 1);
      haze.position.z = -plumeLength * 0.45;
      hazeMaterial.uniforms.uTime.value = time + seed;
      hazeMaterial.uniforms.uStrength.value = (0.1 + 0.22 * energy) * (1 + 1.4 * boost);
    }

    /* --- single dynamic light -------------------------------------------- */

    // The scene already carries trackside lights and a per-car underglow, so
    // this is the only light the exhaust adds and it falls to zero off boost.
    const light = lightRef.current;
    if (light) {
      const intensity = (boost * 14 + flare * 10) * (0.85 + 0.3 * (fbm1(time * 11 + seed) - 0.5));
      light.visible = intensity > 0.02;
      light.intensity = Math.max(0, intensity);
      light.position.z = -plumeLength * 0.35;
    }
  });

  return (
    <group ref={rootRef} position={offset}>
      {/* Heat haze sits furthest back so the plume always draws over it. */}
      <mesh
        ref={hazeRef}
        geometry={shared.discGeometry}
        material={hazeMaterial}
        renderOrder={1}
      />

      {/* Beams and shock diamonds share the axial billboard roll. */}
      <group ref={rollRef}>
        {BEAM_LAYERS.map((_layer, index) => (
          <mesh
            key={`beam-${index}`}
            ref={(mesh) => {
              beamRefs.current[index] = mesh;
            }}
            geometry={shared.beamGeometry}
            material={beamMaterials[index]}
            rotation={[Math.PI / 2, 0, 0]}
            renderOrder={2 + index}
          />
        ))}

        {SHOCK_DIAMONDS.map((_, index) => (
          <mesh
            key={`shock-${index}`}
            ref={(mesh) => {
              shockRefs.current[index] = mesh;
            }}
            geometry={shared.discGeometry}
            material={shockMaterial}
            rotation={[Math.PI / 2, 0, 0]}
            visible={false}
            renderOrder={6}
          />
        ))}
      </group>

      {coreMaterials.map((material, index) => (
        <mesh
          key={`core-${index}`}
          ref={(mesh) => {
            coreRefs.current[index] = mesh;
          }}
          geometry={shared.discGeometry}
          material={material}
          renderOrder={7 + index}
        />
      ))}

      <pointLight
        ref={lightRef}
        color={ACCENT_COLOR}
        intensity={0}
        distance={9}
        decay={2}
        visible={false}
      />
    </group>
  );
});
