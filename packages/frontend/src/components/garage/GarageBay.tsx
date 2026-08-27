import { Environment, Grid, Lightformer, MeshReflectorMaterial, Text } from "@react-three/drei";
import { DS, FONT_BOLD, FONT_REGULAR } from "./design";

/**
 * The room the fleet stands in.
 *
 * A photographic bay rather than a garage: a polished floor that carries the
 * reflection of an overhead light rig, a surveyor's grid that fades out before
 * it meets a wall, and nothing else. The cars are the only thing with colour.
 */

/**
 * The rig is felt, not seen: three shaped spots do the shadows while the
 * environment strips draw the highlights down each flank. Nothing emissive
 * hangs in the room, because at fleet height the camera would be looking
 * straight at it.
 */
function LightRig() {
  return (
    <group>
      {/* Key light on the stage, warm-neutral so white paint stays white. */}
      <spotLight
        position={[0, 16, 6]}
        angle={0.42}
        penumbra={0.9}
        intensity={110}
        distance={60}
        decay={2}
        color="#fff8ee"
      />

      {/* The only shadow caster: wide enough to cover the deepest fleet grid. */}
      <directionalLight
        position={[7, 26, 12]}
        intensity={1.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0006}
        shadow-camera-near={1}
        shadow-camera-far={90}
        shadow-camera-left={-48}
        shadow-camera-right={48}
        shadow-camera-top={48}
        shadow-camera-bottom={-48}
      />
      {/* Rim from behind — separates the silhouette from the back wall. */}
      <spotLight
        position={[-16, 11, -18]}
        angle={0.6}
        penumbra={1}
        intensity={70}
        distance={80}
        decay={2}
        color="#cfe4ff"
      />
      <spotLight
        position={[18, 10, -16]}
        angle={0.6}
        penumbra={1}
        intensity={50}
        distance={80}
        decay={2}
        color="#ffffff"
      />
      <ambientLight intensity={0.18} />
    </group>
  );
}

/** Polished concrete: the reflection is what sells the scale of the room. */
function Floor() {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, -10]} receiveShadow>
        <planeGeometry args={[240, 240]} />
        <MeshReflectorMaterial
          blur={[420, 140]}
          resolution={1024}
          mixBlur={1.1}
          mixStrength={30}
          roughness={0.72}
          depthScale={1.1}
          minDepthThreshold={0.35}
          maxDepthThreshold={1.3}
          color="#070707"
          metalness={0.85}
          mirror={0.55}
        />
      </mesh>

      <Grid
        position={[0, 0.004, -10]}
        args={[200, 200]}
        cellSize={2}
        cellThickness={0.45}
        cellColor="#181818"
        sectionSize={12}
        sectionThickness={0.9}
        sectionColor="#2E2E2E"
        fadeDistance={95}
        fadeStrength={1.4}
        infiniteGrid
      />
    </>
  );
}

/** Far end of the bay — one lit seam at eye height, nothing else. */
function BackWall() {
  return (
    <group position={[0, 0, -52]}>
      <mesh position={[0, 13, 0]}>
        <planeGeometry args={[200, 26]} />
        <meshStandardMaterial color="#0B0B0B" roughness={0.95} metalness={0.1} />
      </mesh>
      <mesh position={[0, 1.4, 0.12]}>
        <boxGeometry args={[200, 0.06, 0.06]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * The selected token, printed on the back of the bay at wall scale.
 *
 * Built as a neon sign rather than a filled headline: the digits are glass, and
 * only their edge carries the accent. That thin stroke is the one thing in the
 * room bright enough to clear the bloom threshold, so the glow comes out of the
 * lighting rather than out of an opacity value — legible from across the bay,
 * and still quiet enough to sit behind the car.
 */
function GhostPlate({ tokenId, subtitle }: { tokenId: number; subtitle: string }) {
  return (
    <group position={[0, 0, -30]}>
      <Text
        font={FONT_BOLD}
        fontSize={6.2}
        letterSpacing={0.06}
        position={[0, 5.6, 0]}
        color="#070D0A"
        fillOpacity={0.92}
        strokeWidth="1.6%"
        strokeColor={DS.accent}
        strokeOpacity={0.44}
        outlineWidth="4%"
        outlineBlur="18%"
        outlineColor={DS.accent}
        outlineOpacity={0.05}
        anchorX="center"
        anchorY="middle"
      >
        {String(tokenId).padStart(4, "0")}
      </Text>
      <Text
        font={FONT_REGULAR}
        fontSize={0.62}
        letterSpacing={0.34}
        position={[0, 1.5, 0]}
        color={DS.accent}
        fillOpacity={0.22}
        anchorX="center"
        anchorY="middle"
      >
        {subtitle}
      </Text>
    </group>
  );
}

/**
 * The environment map is a set of soft strips standing in for the rig above. It
 * is what draws the long highlights down the flank of a car; the scene lights
 * only do the shadows.
 */
function BayEnvironment() {
  return (
    <Environment resolution={256} frames={1}>
      <color attach="background" args={["#050505"]} />
      {[-9, -3, 3, 9].map((x) => (
        <Lightformer
          key={x}
          form="rect"
          intensity={2.2}
          position={[x, 7, -4]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[2.4, 18, 1]}
        />
      ))}
      <Lightformer form="rect" intensity={1.4} position={[-14, 3, 6]} rotation={[0, Math.PI / 2, 0]} scale={[16, 8, 1]} />
      <Lightformer form="rect" intensity={1.4} position={[14, 3, 6]} rotation={[0, -Math.PI / 2, 0]} scale={[16, 8, 1]} />
      <Lightformer form="rect" intensity={0.7} position={[0, 2, -18]} scale={[30, 6, 1]} />
    </Environment>
  );
}

export function GarageBay({
  tokenId,
  subtitle,
  showPlate,
}: {
  tokenId: number;
  subtitle: string;
  /** The stencil is scenery for the wide shots; inspect frames the car alone. */
  showPlate: boolean;
}) {
  return (
    <group>
      <BayEnvironment />
      <LightRig />
      <Floor />
      <BackWall />
      {showPlate && <GhostPlate tokenId={tokenId} subtitle={subtitle} />}


    </group>
  );
}
