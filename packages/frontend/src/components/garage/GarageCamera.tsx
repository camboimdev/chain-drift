import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Vector3 } from "three";
import type { OrbitControls as OrbitControlsType } from "three/examples/jsm/controls/OrbitControls.js";
import { gridCenterZ, gridRows } from "./layout";
import type { GarageMode } from "./layout";

/**
 * One camera for three modes.
 *
 * Gallery and fleet are composed shots — the camera is driven, not orbited, and
 * only breathes with the pointer. Inspect hands control over to the user, so
 * the rig lerps into place once and then stops writing to the camera at all.
 */

const GALLERY_POS  = new Vector3(0, 4.7, 15.4);
const GALLERY_LOOK = new Vector3(0, 1.05, -2.2);
const INSPECT_POS  = new Vector3(5.6, 2.5, 6.8);
const INSPECT_LOOK = new Vector3(0, 0.9, 0);

/** Far enough back that the last row still reads, however deep the fleet is. */
function fleetShot(total: number): { pos: Vector3; look: Vector3 } {
  const rows    = gridRows(total);
  const centerZ = gridCenterZ(total);
  return {
    pos:  new Vector3(0, 8 + rows * 4.2, centerZ + 9 + rows * 6.6),
    look: new Vector3(0, 0.4, centerZ),
  };
}

export function GarageCamera({ mode, fleetSize }: { mode: GarageMode; fleetSize: number }) {
  const settled = useRef(false);
  const desired = useRef(new Vector3());

  const shot = useMemo(() => {
    if (mode === "fleet")   return fleetShot(Math.max(1, fleetSize));
    if (mode === "inspect") return { pos: INSPECT_POS, look: INSPECT_LOOK };
    return { pos: GALLERY_POS, look: GALLERY_LOOK };
  }, [mode, fleetSize]);

  useEffect(() => {
    settled.current = false;
  }, [mode, fleetSize]);

  useFrame((state, delta) => {
    if (mode === "inspect" && settled.current) return;

    const step = Math.min(1, 2.8 * delta);
    const controls = state.controls as unknown as OrbitControlsType | null;

    // A shallow pointer parallax: enough to feel hand-held, never enough to
    // break the composition.
    desired.current.copy(shot.pos);
    if (mode !== "inspect") {
      desired.current.x += state.pointer.x * 1.1;
      desired.current.y += state.pointer.y * 0.4;
    }

    state.camera.position.lerp(desired.current, step);
    if (controls) {
      controls.target.lerp(shot.look, step);
      controls.update();
    }

    if (mode === "inspect" && state.camera.position.distanceTo(shot.pos) < 0.12) {
      settled.current = true;
    }
  });

  return null;
}
