/**
 * Render NFT preview images for all Chain Drift cars.
 *
 * Uses Puppeteer + Three.js (CDN) to render each car.glb into a
 * 1024x1024 cyberpunk-city scene, saved as nft.png per car.
 *
 * Usage:
 *   node scripts/render-nft-previews.mjs           # all cars
 *   node scripts/render-nft-previews.mjs 5 11 12   # specific car IDs
 *
 * REQUIRES the asset pipeline output: a `chain_drift_pipeline/` directory
 * beside this repository, holding `output/collection/collection.json` and one
 * `car_NNN/` folder per car. It is not part of this repository, and without it
 * this script cannot run.
 *
 * You only need this to re-pin or extend the collection. The 61 published cars
 * are already pinned, recorded in `packages/frontend/src/data/collectionManifest.ts`,
 * and pointed at by the deployed contract's base URI.
 */

import { createRequire } from "module";
import { createServer } from "http";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join, extname, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// puppeteer is not a dependency of this repository — install it on demand:
//   pnpm add -w -D puppeteer
const puppeteer = require(
  join(__dirname, "../node_modules/puppeteer")
);

// ── Config ────────────────────────────────────────────────────────────────────

const COLLECTION_DIR = join(
  __dirname,
  "../chain_drift_pipeline/output/collection"
);
const RENDER_SIZE = 1024;
const CONCURRENCY = 3;

// ── Local HTTP server ─────────────────────────────────────────────────────────

function startServer(port = 7788) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const filePath = join(COLLECTION_DIR, decodeURIComponent(req.url));
      if (!existsSync(filePath)) {
        res.writeHead(404);
        res.end();
        return;
      }
      const ext = extname(filePath);
      const mime =
        ext === ".glb" ? "model/gltf-binary" : "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": mime,
        "Access-Control-Allow-Origin": "*",
      });
      res.end(readFileSync(filePath));
    });
    server.listen(port, () => resolve({ server, port }));
  });
}

// ── HTML scene template ───────────────────────────────────────────────────────

function buildHTML(glbUrl, size) {
  return /* html */ `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { margin:0; padding:0; }
body { width:${size}px; height:${size}px; overflow:hidden; background:#000; }
canvas { display:block; }
</style>
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.167.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.167.0/examples/jsm/"
  }
}
</script>
</head>
<body>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const W = ${size}, H = ${size};

// ── Renderer ──────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x04020c, 0.12);

// ── Camera ────────────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(44, W / H, 0.01, 200);
camera.position.set(2.4, 1.5, 3.0);
camera.lookAt(0, 0.3, 0);

// ── Sky gradient background ───────────────────────────────────────────────────
{
  const skyGeo = new THREE.SphereGeometry(80, 16, 8);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor:    { value: new THREE.Color(0x000008) },
      midColor:    { value: new THREE.Color(0x0d0020) },
      bottomColor: { value: new THREE.Color(0x1a0035) },
    },
    vertexShader: \`
      varying vec3 vWorldPos;
      void main() {
        vWorldPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }
    \`,
    fragmentShader: \`
      uniform vec3 topColor, midColor, bottomColor;
      varying vec3 vWorldPos;
      void main() {
        float t = clamp((vWorldPos.y + 10.0) / 30.0, 0.0, 1.0);
        vec3 col = t > 0.5
          ? mix(midColor, topColor, (t - 0.5) * 2.0)
          : mix(bottomColor, midColor, t * 2.0);
        gl_FragColor = vec4(col, 1.0);
      }
    \`,
    depthWrite: false,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
}

// ── Stars ─────────────────────────────────────────────────────────────────────
{
  const starCount = 600;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(Math.random() * 0.9);  // upper hemisphere
    const r     = 60 + Math.random() * 15;
    positions[i*3]   = r * Math.sin(phi) * Math.cos(theta);
    positions[i*3+1] = r * Math.cos(phi);
    positions[i*3+2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xffffff, size: 0.18, sizeAttenuation: true, transparent: true, opacity: 0.7,
  })));
}

// ── City skyline ──────────────────────────────────────────────────────────────
{
  const rng = (min, max) => Math.random() * (max - min) + min;
  const buildingColors = [0x0a0020, 0x060018, 0x080024, 0x040012];
  const glowColors     = [0x00ffcc, 0xff00aa, 0x4488ff, 0xffaa00, 0xff0066, 0x00aaff];

  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 22; i++) {
      const w = rng(0.6, 2.2);
      const h = rng(2.0, 9.0);
      const d = rng(0.5, 1.5);
      const x = side * (rng(4.5, 18));
      const z = rng(-14, -5);

      // Building body
      const bodyGeo = new THREE.BoxGeometry(w, h, d);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: buildingColors[Math.floor(Math.random() * buildingColors.length)],
        roughness: 0.9, metalness: 0.1,
        emissive: 0x000008, emissiveIntensity: 1,
      });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.set(x, h / 2, z);
      scene.add(body);

      // Window dots (emissive planes on front face)
      const winColor = glowColors[Math.floor(Math.random() * glowColors.length)];
      const rows = Math.floor(h / 0.55);
      const cols = Math.floor(w / 0.45);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (Math.random() < 0.45) continue;
          const wGeo = new THREE.PlaneGeometry(0.12, 0.10);
          const wMat = new THREE.MeshBasicMaterial({ color: winColor });
          const win = new THREE.Mesh(wGeo, wMat);
          win.position.set(
            x - w/2 + 0.25 + c * 0.45,
            0.3 + r * 0.55,
            z + d/2 + 0.01
          );
          scene.add(win);
        }
      }

      // Rooftop neon stripe
      const stripeMat = new THREE.MeshBasicMaterial({ color: winColor });
      const stripeGeo = new THREE.BoxGeometry(w + 0.08, 0.06, d + 0.08);
      const stripe = new THREE.Mesh(stripeGeo, stripeMat);
      stripe.position.set(x, h + 0.03, z);
      scene.add(stripe);
    }
  }
}

// ── Ground ────────────────────────────────────────────────────────────────────
{
  // Base dark tarmac
  const groundGeo = new THREE.PlaneGeometry(30, 30);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x060610, roughness: 0.85, metalness: 0.4,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Neon grid overlay
  const gridHelper = new THREE.GridHelper(28, 28, 0x1a0040, 0x0f0025);
  gridHelper.position.y = 0.002;
  scene.add(gridHelper);

  // Bright center lane lines (cyan/purple)
  for (let i = -2; i <= 2; i++) {
    const lineGeo = new THREE.PlaneGeometry(0.04, 14);
    const lineMat = new THREE.MeshBasicMaterial({ color: i === 0 ? 0x00ffcc : 0x6600ff });
    const line = new THREE.Mesh(lineGeo, lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(i * 1.0, 0.003, -3);
    scene.add(line);
  }

  // Neon circles under car
  for (const [radius, color] of [[1.6, 0x00ffcc], [2.2, 0x4400ff], [2.9, 0xff0088]]) {
    const pts = [];
    for (let j = 0; j <= 80; j++) {
      const a = (j / 80) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0.004, Math.sin(a) * radius));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    scene.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color })));
  }
}

// ── Lighting ──────────────────────────────────────────────────────────────────
// Ambient
scene.add(new THREE.AmbientLight(0x150830, 4));

// Key — warm white from front-right-top
const key = new THREE.DirectionalLight(0xfff8e8, 4.5);
key.position.set(4, 7, 5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 25;
key.shadow.camera.left = key.shadow.camera.bottom = -4;
key.shadow.camera.right = key.shadow.camera.top  =  4;
key.shadow.bias = -0.001;
scene.add(key);

// Rim — electric blue from rear-left
const rim = new THREE.DirectionalLight(0x0066ff, 4);
rim.position.set(-5, 3, -5);
scene.add(rim);

// Fill — neon purple from left
const fill = new THREE.DirectionalLight(0xaa00ff, 2);
fill.position.set(-4, 1, 3);
scene.add(fill);

// Underglow — cyan beneath car
const underglow = new THREE.PointLight(0x00ffcc, 3, 4, 2);
underglow.position.set(0, -0.05, 0);
scene.add(underglow);

// City bounce — warm from background buildings
const cityBounce = new THREE.HemisphereLight(0x220044, 0x001122, 1.5);
scene.add(cityBounce);

// ── Post-processing ───────────────────────────────────────────────────────────
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.7, 0.4, 0.75);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ── Load car model ────────────────────────────────────────────────────────────
window.__result = null;

new GLTFLoader().load('${glbUrl}', (gltf) => {
  const model = gltf.scene;

  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3());
  const scale  = 2.0 / Math.max(size.x, size.y, size.z);

  model.scale.setScalar(scale);
  model.position.sub(center.multiplyScalar(scale));

  // Sit on ground
  const box2 = new THREE.Box3().setFromObject(model);
  model.position.y -= box2.min.y;

  model.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach((m) => {
      m.envMapIntensity = 1.5;
      if (m.emissive) m.emissiveIntensity = (m.emissiveIntensity || 0) * 1.5 + 0.02;
    });
  });

  scene.add(model);

  // Let layout settle then render
  requestAnimationFrame(() => {
    composer.render();
    window.__result = renderer.domElement.toDataURL('image/png');
  });
}, undefined, (err) => {
  window.__result = 'error:' + err.message;
});
</script>
</body>
</html>`;
}

// ── Render one car ────────────────────────────────────────────────────────────

async function renderCar(browser, carId, port) {
  const tag = `car_${String(carId).padStart(3, "0")}`;
  const glbUrl = `http://localhost:${port}/${tag}/car.glb`;
  const outPath = join(COLLECTION_DIR, tag, "nft.png");

  const page = await browser.newPage();
  await page.setViewport({ width: RENDER_SIZE, height: RENDER_SIZE });

  const html = buildHTML(glbUrl, RENDER_SIZE);
  await page.setContent(html, { waitUntil: "domcontentloaded" });

  let dataURL;
  try {
    dataURL = await page.waitForFunction(
      () => window.__result !== null,
      { timeout: 30000 }
    ).then(() => page.evaluate(() => window.__result));
  } catch {
    console.error(`  [${tag}] timeout`);
    await page.close();
    return false;
  }

  if (!dataURL || dataURL.startsWith("error:")) {
    console.error(`  [${tag}] render error: ${dataURL}`);
    await page.close();
    return false;
  }

  // dataURL → PNG file
  const base64 = dataURL.replace(/^data:image\/png;base64,/, "");
  writeFileSync(outPath, Buffer.from(base64, "base64"));
  await page.close();
  console.log(`  ✓ ${tag}`);
  return true;
}

// ── Concurrency pool ──────────────────────────────────────────────────────────

async function runPool(tasks, concurrency) {
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      await tasks[idx++]();
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  let carIds;

  if (args.length > 0) {
    carIds = args.map(Number);
  } else {
    carIds = [];
    for (let i = 1; i <= 100; i++) {
      const tag = `car_${String(i).padStart(3, "0")}`;
      if (existsSync(join(COLLECTION_DIR, tag, "car.glb"))) carIds.push(i);
    }
  }

  console.log(`Rendering ${carIds.length} cars at ${RENDER_SIZE}×${RENDER_SIZE}...`);

  const { server, port } = await startServer();
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const tasks = carIds.map((id) => () => renderCar(browser, id, port));
    await runPool(tasks, CONCURRENCY);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\nDone — images saved to ${COLLECTION_DIR}/car_NNN/nft.png`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
