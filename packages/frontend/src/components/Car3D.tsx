import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box3, Group, MathUtils, Mesh, Vector3 } from "three";
import { GLTFLoader } from "three-stdlib";
import type { GLTF } from "three-stdlib";
import { getCarManifest } from "../data/collectionManifest";
import { fetchIpfs } from "../config/ipfs";

// Target length of the car along its longest horizontal axis (world units).
const TARGET_CAR_LENGTH = 6.0;

// One in-flight/completed load per model URL, shared by every car that uses it.
const modelCache = new Map<string, Promise<GLTF>>();

/**
 * Load a GLB through the IPFS gateway fallback chain and parse it.
 * Failures evict the cache entry so a later mount can retry.
 */
function loadCarModel(modelUrl: string): Promise<GLTF> {
  let pending = modelCache.get(modelUrl);
  if (!pending) {
    pending = fetchIpfs(modelUrl).then(
      (buffer) =>
        new Promise<GLTF>((resolve, reject) => {
          new GLTFLoader().parse(buffer, "", resolve, reject);
        })
    );
    pending.catch(() => modelCache.delete(modelUrl));
    modelCache.set(modelUrl, pending);
  }
  return pending;
}

interface Car3DProps {
  tokenId: number;
  position: [number, number, number];
  isSelected?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
}

function GLBModel({ modelUrl, dimmed }: { modelUrl: string; dimmed?: boolean }) {
  const [gltf, setGltf] = useState<GLTF | null>(null);
  const [failed, setFailed] = useState(false);

  // Loading happens in an effect rather than via Suspense so an unreachable
  // gateway degrades to a placeholder instead of throwing through the tree.
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

    const scene = gltf.scene.clone();
    scene.traverse((child) => {
      if (child instanceof Mesh) {
        child.castShadow    = true;
        child.receiveShadow = true;
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
    prepared.scene.traverse((child) => {
      if (child instanceof Mesh) {
        child.material.transparent = dimmed ?? false;
        child.material.opacity     = dimmed ? 0.65 : 1.0;
        child.material.depthWrite  = !(dimmed ?? false);
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

function Car3DModel({ tokenId, position, isSelected = false, dimmed = false, onClick }: Car3DProps) {
  const carGroupRef = useRef<Group>(null);
  const [hovered, setHovered] = useState(false);

  const manifest  = getCarManifest(tokenId);
  const modelUrl  = manifest?.model ?? null;

  useFrame((state, delta) => {
    if (carGroupRef.current) {
      const targetScale = hovered ? 1.1 : 1;
      const currentScale = carGroupRef.current.scale.x;
      carGroupRef.current.scale.setScalar(
        MathUtils.lerp(currentScale, targetScale, delta * 10)
      );

      if (isSelected) {
        carGroupRef.current.rotation.y =
          Math.sin(state.clock.elapsedTime * 0.5) * 0.1;
      }
    }
  });

  return (
    <group
      ref={carGroupRef}
      position={position}
      onClick={onClick}
      onPointerEnter={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerLeave={(e) => {
        e.stopPropagation();
        setHovered(false);
        document.body.style.cursor = "auto";
      }}
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
