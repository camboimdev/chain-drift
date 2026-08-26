import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector3 } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PartType } from "@chain-drift/shared";

export type ViewMode = "Gallery" | "Studio";

interface CameraControllerProps {
  viewMode: ViewMode;
  focusPart: PartType;
  partPositions?: Record<string, Vector3>;
}

// Offsets for different views relative to the focus point
const VIEW_OFFSETS: Partial<Record<PartType, Vector3>> = {
  // Main Body
  BodyShell: new Vector3(5, 3, 5),
  Chassis: new Vector3(5, 3, 5),
  FrontBumper: new Vector3(2, 1, 3),
  RearBumper: new Vector3(-2, 1, -3),
  Hood: new Vector3(1, 1.5, 2),
  Trunk: new Vector3(-1, 1.5, -2),
  Spoiler: new Vector3(-2, 2, -3),

  // Wheels
  FrontLeftWheel: new Vector3(1.5, 0.5, 1.5),
  FrontRightWheel: new Vector3(-1.5, 0.5, 1.5),
  RearLeftWheel: new Vector3(1.5, 0.5, -1.5),
  RearRightWheel: new Vector3(-1.5, 0.5, -1.5),

  // Visuals
  LeftHeadlight: new Vector3(1, 1, 3),
  RightHeadlight: new Vector3(-1, 1, 3),
  LeftTailLight: new Vector3(1, 1, -3),
  RightTailLight: new Vector3(-1, 1, -3),

  // Interior
  SteeringWheel: new Vector3(0.5, 1.2, 0.5),
  Dashboard: new Vector3(0, 1.2, 0.5),
  FrontSeats: new Vector3(0, 1.5, 0),

  // Engine
  EngineBlock: new Vector3(0, 2, 2.5),
};

const DEFAULT_OFFSET = new Vector3(4, 3, 6);

export function CameraController({
  viewMode,
  focusPart,
  partPositions,
}: CameraControllerProps) {
  const { camera } = useThree();

  // Target position and lookAt refs
  const targetPos = useRef(new Vector3(0, 6, 22)); // Gallery default - Lower and wider
  const targetLookAt = useRef(new Vector3(0, 0, 0));

  useEffect(() => {
    if (viewMode === "Gallery") {
      targetPos.current.set(0, 6, 22);
      targetLookAt.current.set(0, 0, 0);
    } else if (viewMode === "Studio") {
      // Calculate target based on part
      const partOffset = VIEW_OFFSETS[focusPart] || DEFAULT_OFFSET;

      // Get part center from recorded positions, or default to origin
      const partCenter = new Vector3(0, 0, 0);

      if (partPositions) {
        // Try to find exact match or fallback
        if (partPositions[focusPart]) {
          partCenter.copy(partPositions[focusPart]);
        } else if (partPositions["Body"]) {
          // Fallback to main body center if specific part not found
          partCenter.copy(partPositions["Body"]);
        }
      }

      targetLookAt.current.copy(partCenter);

      // The camera position is part center + offset
      // We might want to rotate the offset based on car rotation if the car rotates?
      // But here we assume car is at identity rotation in studio.
      targetPos.current.copy(partCenter).add(partOffset);
    }
  }, [viewMode, focusPart, partPositions]);

  useFrame((state, delta) => {
    // Smoothly interpolate camera position
    const dampFactor = 4 * delta;

    camera.position.lerp(targetPos.current, dampFactor);

    const controls = state.controls as unknown as OrbitControls;
    if (controls) {
      controls.target.lerp(targetLookAt.current, dampFactor);
      controls.update();
    } else {
      const currentLookAt = new Vector3(0, 0, -1)
        .applyQuaternion(camera.quaternion)
        .add(camera.position);
      const newLookAt = currentLookAt.lerp(targetLookAt.current, dampFactor);
      camera.lookAt(newLookAt);
    }
  });

  return null;
}
