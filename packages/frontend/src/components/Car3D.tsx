import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box3, Group, MathUtils, Mesh, Vector3 } from "three";
import type { GLTF } from "three-stdlib";
import { getCarManifest } from "../data/collectionManifest";
import { loadCarModel } from "../services/carModelPreloader";

// Target length of the car along its longest horizontal axis (world units).
const TARGET_CAR_LENGTH = 6.0;

interface Car3DProps {
  tokenId: number;
  position: [number, number, number];
  isSelected?: boolean;
  dimmed?: boolean;
  /**
   * Showroom behaviour: hover scaling, pointer cursor and the idle yaw wobble.
   * Off by default — in a race the parent group owns the car's transform and a
   * child writing rotation.y would fight it.
   */
  interactive?: boolean;
  onClick?: () => void;
}

function GLBModel({ modelUrl, dimmed }: { modelUrl: string; dimmed?: boolean }) {
  const [gltf, setGltf] = useState<GLTF | null>(null);
  const [failed, setFailed] = useState(false);

  // Loading happens in an effect rather than via Suspense so an unreachable
  // gateway degrades to a placeholder instead of throwing through the tree.
  // When the race preloader has already warmed the cache this resolves on the
  // first microtask, so the car is never a wireframe on the starting grid.
  useEffect(() => {
    let cancelled = false;
    setGltf(null);
    setFailed(false);

    loadCarModel(modelUrl).then(
      (loaded) => {
        if (!cancelled) setGltf(loaded);
      },
      (err) => {
        if (cancelled) return;
        console.error(`[Car3D] Could not load model ${modelUrl}:`, err);
        setFailed(true);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [modelUrl]);

  const prepared = useMemo(() => {
    if (!gltf) return null;

    // `clone()` shares materials with every other clone of the same GLTF, so
    // each instance gets its own copies — otherwise dimming one car dims every
    // car that happens to use the same model.
    const scene = gltf.scene.clone();
    scene.traverse((child) => {
      if (child instanceof Mesh) {
        child.castShadow    = true;
        child.receiveShadow = true;
        child.material = Array.isArray(child.material)
          ? child.material.map((material) => material.clone())
          : child.material.clone();
      }
    });

    // Compute bounding box in original (unscaled) space
    const box  = new Box3().setFromObject(scene);
    const size = new Vector3();
    box.getSize(size);

    // Scale so the longest horizontal dimension equals TARGET_CAR_LENGTH
    const longest = Math.max(size.x, size.z);
    const scale = longest > 0 ? TARGET_CAR_LENGTH / longest : 1;

    // Lift the model so its bottom (min Y) sits exactly at Y=0
    const yLift = -box.min.y * scale;

    return { scene, scale, yLift };
  }, [gltf]);

  useEffect(() => {
    if (!prepared) return;
    const isDimmed = dimmed ?? false;
    prepared.scene.traverse((child) => {
      if (child instanceof Mesh) {
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];
        for (const material of materials) {
          material.transparent = isDimmed;
          material.opacity     = isDimmed ? 0.65 : 1.0;
          material.depthWrite  = !isDimmed;
        }
      }
    });
  }, [prepared, dimmed]);

  if (!prepared) return <CarPlaceholder failed={failed} />;

  return (
    <primitive
      object={prepared.scene}
      scale={prepared.scale}
      position={[0, prepared.yLift, 0]}
    />
  );
}

function Car3DModel({
  tokenId,
  position,
  isSelected = false,
  dimmed = false,
  interactive = false,
  onClick,
}: Car3DProps) {
  const carGroupRef = useRef<Group>(null);
  const [hovered, setHovered] = useState(false);

  const manifest  = getCarManifest(tokenId);
  const modelUrl  = manifest?.model ?? null;

  useFrame((state, delta) => {
    if (!interactive || !carGroupRef.current) return;

    const targetScale = hovered ? 1.1 : 1;
    const currentScale = carGroupRef.current.scale.x;
    carGroupRef.current.scale.setScalar(
      MathUtils.lerp(currentScale, targetScale, delta * 10)
    );

    if (isSelected) {
      carGroupRef.current.rotation.y =
        Math.sin(state.clock.elapsedTime * 0.5) * 0.1;
    }
  });

  return (
    <group
      ref={carGroupRef}
      position={position}
      onClick={onClick}
      onPointerEnter={
        interactive
          ? (e) => {
              e.stopPropagation();
              setHovered(true);
              document.body.style.cursor = "pointer";
            }
          : undefined
      }
      onPointerLeave={
        interactive
          ? (e) => {
              e.stopPropagation();
              setHovered(false);
              document.body.style.cursor = "auto";
            }
          : undefined
      }
    >
      {modelUrl ? (
        <GLBModel modelUrl={modelUrl} dimmed={dimmed} />
      ) : (
        <CarPlaceholder failed />
      )}
    </group>
  );
}

/** Wireframe stand-in shown while a model loads, or red once it gave up. */
function CarPlaceholder({
  failed = false,
  position,
}: {
  failed?: boolean;
  position?: [number, number, number];
}) {
  return (
    <group position={position ?? [0, 0, 0]}>
      <mesh>
        <boxGeometry args={[2.4, 1, 4.8]} />
        <meshStandardMaterial color={failed ? "#ff4444" : "#888888"} wireframe />
      </mesh>
    </group>
  );
}

export type { Car3DProps };

export { Car3DModel as Car3D };
