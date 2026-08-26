/**
 * CarPreview — standalone car render page for NFT thumbnail generation.
 *
 * Accessible at /preview/:tokenId — renders just the car on a neutral
 * background with no game UI. Loads the pre-generated GLB from IPFS via
 * the collection manifest.
 *
 * The canvas element is ready to screenshot once the "data-ready" attribute
 * appears on <body> (set after a short settle delay).
 */
import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect } from "react";
import { Car3D } from "./Car3D";

interface CarPreviewProps {
  tokenId: number;
}

export function CarPreview({ tokenId }: CarPreviewProps) {
  // Signal to puppeteer that the scene has settled
  useEffect(() => {
    const timer = setTimeout(() => {
      document.body.setAttribute("data-ready", "true");
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      style={{
        width:     "512px",
        height:    "512px",
        background: "#111318",
        overflow:  "hidden",
        position:  "fixed",
        top:        0,
        left:       0,
      }}
    >
      <Canvas
        camera={{ position: [3.5, 2.2, 6], fov: 40 }}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        shadows
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[8, 12, 8]} intensity={1.4} castShadow />
        <directionalLight position={[-6, 4, -6]} intensity={0.4} color="#6699ff" />
        <pointLight position={[0, 3, 0]} intensity={0.3} />

        <Suspense fallback={null}>
          <Car3D tokenId={tokenId} position={[0, 0, 0]} interactive />
        </Suspense>
      </Canvas>
    </div>
  );
}
