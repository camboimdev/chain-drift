import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  MathUtils,
  MeshBasicMaterial,
  Vector3,
} from "three";
import type { CarNFT } from "@chain-drift/shared";
import { Car3D } from "../Car3D";
import {
  FONT_BOLD,
  FONT_REGULAR,
  RARITY_BRIGHTNESS,
  RARITY_PULSES,
  tokenLabel,
} from "./design";
import type { GarageMode, Placement } from "./layout";

/**
 * One car, standing on its own patch of floor.
 *
 * The bay owns everything that is *about* the car rather than the car itself:
 * where it stands, what is painted under it, and how brightly its rarity reads.
 * Placement comes from `computeLayout`; the bay only ever lerps towards it, so
 * changing modes and changing selection are the same motion.
 */

const PAD_RADIUS   = 4.2;
const TURNTABLE    = 0.13; // rad/s — one revolution in ~48s
const POS_LERP     = 3.6;
const SCALE_LERP   = 5.0;

// ─── Shared geometry ─────────────────────────────────────────────────────────
// Built once at module scope: every bay draws the same brackets and the same
// dial, so there is no reason for each to own a copy.

const TICK_GEOMETRY = (() => {
  const points: number[] = [];
  const count = 72;
  for (let k = 0; k < count; k += 1) {
    const angle = (k / count) * Math.PI * 2;
    const major = k % 6 === 0;
    const inner = PAD_RADIUS + (major ? 0.02 : 0.24);
    const outer = PAD_RADIUS + 0.46;
    points.push(
      Math.cos(angle) * inner, 0, Math.sin(angle) * inner,
      Math.cos(angle) * outer, 0, Math.sin(angle) * outer
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
  return geometry;
})();

const BRACKET_GEOMETRY = (() => {
  const half = 4.1;
  const arm  = 1.5;
  const points: number[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      points.push(sx * half, 0, sz * half, sx * (half - arm), 0, sz * half);
      points.push(sx * half, 0, sz * half, sx * half, 0, sz * (half - arm));
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
  return geometry;
})();

// ─── Scan pad — the featured car ─────────────────────────────────────────────

function ScanPad({ brightness, pulses }: { brightness: number; pulses: boolean }) {
  const ringMaterial  = useRef<MeshBasicMaterial>(null);
  const sweepRef      = useRef<Group>(null);

  useFrame((state, delta) => {
    if (sweepRef.current) sweepRef.current.rotation.y -= delta * 0.55;
    if (!ringMaterial.current) return;
    // Legendary is the only tier that moves: a slow breath, never a blink.
    const pulse = pulses ? 0.82 + Math.sin(state.clock.elapsedTime * 1.6) * 0.18 : 1;
    ringMaterial.current.opacity = brightness * pulse;
  });

  return (
    <group>
      {/* No deck: the mark is drawn straight onto the floor so the car's
          reflection runs unbroken underneath it. */}
      {/* Rarity ring — brightness is the whole signal */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]}>
        <ringGeometry args={[PAD_RADIUS + 0.5, PAD_RADIUS + 0.62, 128]} />
        <meshBasicMaterial ref={ringMaterial} color="#ffffff" transparent opacity={brightness} toneMapped={false} />
      </mesh>

      {/* Measurement dial */}
      <lineSegments geometry={TICK_GEOMETRY} position={[0, 0.03, 0]}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.16} toneMapped={false} />
      </lineSegments>

      {/* Sweep — the pad reads the car it is holding */}
      <group ref={sweepRef} position={[0, 0.028, 0]}>
        <mesh position={[PAD_RADIUS / 2, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[PAD_RADIUS, 0.04]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.13} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

/** Flank and queue cars get the ring alone — a bay they are not standing in. */
function OutlineRing({ opacity }: { opacity: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
      <ringGeometry args={[PAD_RADIUS + 0.5, PAD_RADIUS + 0.58, 96]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={opacity} toneMapped={false} />
    </mesh>
  );
}

/** Fleet view: a parking bracket, its number, and the unit it holds. */
function BayBrackets({
  bay,
  car,
  active,
  highlighted,
}: {
  bay: number;
  car: CarNFT;
  active: boolean;
  highlighted: boolean;
}) {
  const lit   = active || highlighted;
  const color = active ? "#FFFFFF" : highlighted ? "#BFBFBF" : "#2A2A2A";

  return (
    <group>
      <lineSegments geometry={BRACKET_GEOMETRY} position={[0, 0.02, 0]}>
        <lineBasicMaterial color={color} transparent opacity={lit ? 0.95 : 0.5} toneMapped={false} />
      </lineSegments>

      <Text
        font={FONT_BOLD}
        fontSize={0.92}
        letterSpacing={0.16}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[-4.1, 0.03, 5.6]}
        anchorX="left"
        anchorY="middle"
        color={active ? "#FFFFFF" : "#454545"}
      >
        {String(bay).padStart(2, "0")}
      </Text>

      <Text
        font={FONT_REGULAR}
        fontSize={0.62}
        letterSpacing={0.2}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[-2.5, 0.03, 5.62]}
        anchorX="left"
        anchorY="middle"
        color={active ? "#BFBFBF" : "#333333"}
      >
        {`${tokenLabel(car.tokenId)}  ${car.rarity.toUpperCase()}`}
      </Text>
    </group>
  );
}

// ─── Bay ──────────────────────────────────────────────────────────────────────

interface CarBayProps {
  car:         CarNFT;
  placement:   Placement;
  entryPos:    [number, number, number];
  mode:        GarageMode;
  active:      boolean;
  highlighted: boolean;
  onClick:     () => void;
}

export function CarBay({
  car,
  placement,
  entryPos,
  mode,
  active,
  highlighted,
  onClick,
}: CarBayProps) {
  const stageRef = useRef<Group>(null);
  const yawRef   = useRef<Group>(null);

  // Seeded off-stage so a bay that has just joined the scene slides in rather
  // than appearing at its mark. Later renders never read these again.
  const animPos   = useRef(new Vector3(...entryPos));
  const animScale = useRef(0.3);
  const spin      = useRef(0);

  const target = useMemo(() => new Vector3(...placement.pos), [placement.pos]);

  const isHero    = placement.tier === "hero";
  const spinning  = isHero && mode === "gallery";
  const brightness = RARITY_BRIGHTNESS[car.rarity];

  useFrame((_, delta) => {
    if (!stageRef.current || !yawRef.current) return;

    const posStep   = Math.min(1, POS_LERP * delta);
    const scaleStep = Math.min(1, SCALE_LERP * delta);

    animPos.current.lerp(target, posStep);
    animScale.current = MathUtils.lerp(animScale.current, placement.scale, scaleStep);
    stageRef.current.position.copy(animPos.current);
    stageRef.current.scale.setScalar(animScale.current);

    if (spinning) {
      spin.current = (spin.current + delta * TURNTABLE) % (Math.PI * 2);
    } else if (spin.current !== 0) {
      spin.current = 0; // the lerp below walks the car back to its mark
    }

    // Yaw is its own group so the floor markings stay square to the room.
    let dr = placement.rotY + spin.current - yawRef.current.rotation.y;
    if (dr >  Math.PI) dr -= Math.PI * 2;
    if (dr < -Math.PI) dr += Math.PI * 2;
    yawRef.current.rotation.y += dr * posStep;
  });

  return (
    <group ref={stageRef}>
      {isHero && mode !== "inspect" && (
        <ScanPad brightness={brightness} pulses={RARITY_PULSES[car.rarity]} />
      )}

      {placement.tier === "grid" && (
        <BayBrackets bay={placement.bay} car={car} active={active} highlighted={highlighted} />
      )}

      {(placement.tier === "flank" || placement.tier === "queue") && (
        <OutlineRing opacity={highlighted ? 0.5 : 0.12} />
      )}

      <group ref={yawRef}>
        <Car3D
          tokenId={car.tokenId}
          position={[0, 0.06, 0]}
          dimmed={!isHero && !(placement.tier === "grid" && active)}
          interactive
          onClick={onClick}
        />
      </group>
    </group>
  );
}
