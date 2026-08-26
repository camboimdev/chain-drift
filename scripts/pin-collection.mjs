#!/usr/bin/env node
/**
 * Batch Collection Pinner — Chain Drift
 *
 * Pins nft.png + car.glb to Pinata/IPFS for each car in the collection and
 * writes packages/metadata-api/collection-cache.json with { image, model }
 * CIDs per token nonce.
 *
 * NOTE: Individual metadata.json files are NOT pinned here.
 * Metadata is published as a single IPFS directory by pin-metadata-dir.mjs,
 * which reads this cache and builds {folderCID}/{tokenId} entries — the shape
 * CarNFT.tokenURI produces, since it appends the token ID to the base URI.
 *
 * Full publishing flow:
 *   1. node scripts/pin-collection.mjs [--force]   ← this script
 *   2. node scripts/pin-metadata-dir.mjs           ← packages metadata dir
 *   3. cast send $CAR_NFT "setBaseURI(string)" "ipfs://{folderCID}/"
 *
 * Usage:
 *   node scripts/pin-collection.mjs [--concurrency 3] [--force]
 *   node scripts/pin-collection.mjs --force   # re-pin everything
 *
 * Env (loaded from packages/metadata-api/.env):
 *   PINATA_API_KEY, PINATA_API_SECRET
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ─── Load env ────────────────────────────────────────────────────────────────

const envPath = join(ROOT, "packages/metadata-api/.env");
if (existsSync(envPath)) {
  const envText = readFileSync(envPath, "utf8");
  for (const line of envText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

// ─── CLI args ────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    concurrency: { type: "string",  default: "3"    },
    force:       { type: "boolean", default: false  },
  },
  allowPositionals: false,
});

const CONCURRENCY = Math.max(1, Number(values.concurrency));
const FORCE        = values.force;

// ─── Paths ───────────────────────────────────────────────────────────────────

const COLLECTION_DIR  = join(ROOT, "chain_drift_pipeline/output/collection");
const COLLECTION_JSON = join(COLLECTION_DIR, "collection.json");
const CACHE_PATH      = join(ROOT, "packages/metadata-api/collection-cache.json");
const MANIFEST_PATH   = join(ROOT, "packages/frontend/src/data/collectionManifest.ts");
// Gateway baked into the generated manifest. The frontend re-resolves every
// URL against VITE_IPFS_GATEWAYS at runtime, so this is only the default.
const IPFS_GATEWAY    = process.env.IPFS_GATEWAY ?? "https://gateway.pinata.cloud/ipfs";

// ─── Pinata helpers ──────────────────────────────────────────────────────────

function getPinataHeaders() {
  const key    = process.env.PINATA_API_KEY;
  const secret = process.env.PINATA_API_SECRET;
  if (!key || !secret) {
    throw new Error("Missing PINATA_API_KEY or PINATA_API_SECRET.");
  }
  return { pinata_api_key: key, pinata_secret_api_key: secret };
}

async function pinFile(buffer, filename, mimeType) {
  const headers = getPinataHeaders();
  const form    = new FormData();
  const blob    = new Blob([buffer], { type: mimeType });
  form.append("file", blob, filename);
  form.append("pinataMetadata", JSON.stringify({ name: filename }));
  form.append("pinataOptions",  JSON.stringify({ cidVersion: 1 }));

  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method:  "POST",
    headers,
    body:    form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pinata upload failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  return json.IpfsHash;
}

// ─── Cache helpers ───────────────────────────────────────────────────────────

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try { return JSON.parse(readFileSync(CACHE_PATH, "utf8")); } catch { return {}; }
}

function saveCache(data) {
  const tmp = CACHE_PATH + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, CACHE_PATH);
}

// ─── Manifest generator ──────────────────────────────────────────────────────

function rarityFromCollection(car) {
  // The pipeline uses "Uncommon" but our CarRarity type uses "Rare".
  // Map pipeline rarities → CarRarity.
  const map = {
    Common:    "Common",
    Uncommon:  "Rare",
    Rare:      "Rare",
    Epic:      "Epic",
    Legendary: "Legendary",
  };
  return map[car.rarity] ?? "Common";
}

function generateManifest(cache, collectionCars) {
  const carMap = new Map(collectionCars.map((c) => [String(c.index), c]));

  const entries = Object.entries(cache)
    .filter(([, v]) => v.image && v.model)
    .map(([tokenId, v]) => {
      const car = carMap.get(tokenId);
      const rarity = car ? rarityFromCollection(car) : "Common";
      const attributes = car
        ? [
            { trait_type: "Archetype",   value: car.archetype },
            { trait_type: "Neon Color",  value: car.neon_color },
            { trait_type: "Rarity",      value: car.rarity },
          ]
        : [];

      return [
        tokenId,
        {
          model:      `${IPFS_GATEWAY}/${v.model}`,
          image:      `${IPFS_GATEWAY}/${v.image}`,
          rarity,
          attributes,
        },
      ];
    });

  const obj = Object.fromEntries(entries);

  const ts = `// AUTO-GENERATED by scripts/pin-collection.mjs — do not edit manually.
import type { CarRarity } from "@chain-drift/shared";

export interface CollectionManifestEntry {
  model:      string;
  image:      string;
  rarity:     CarRarity;
  attributes: { trait_type: string; value: string }[];
}

export const COLLECTION_MANIFEST: Record<string, CollectionManifestEntry> = ${JSON.stringify(obj, null, 2)};

export function getCarManifest(tokenId: number): CollectionManifestEntry | null {
  return COLLECTION_MANIFEST[String(tokenId)] ?? null;
}
`;
  writeFileSync(MANIFEST_PATH, ts, "utf8");
}

// ─── Per-car pinning ─────────────────────────────────────────────────────────

async function pinCar(car, cache) {
  const index     = car.index;
  const key       = String(index);
  const carDir    = join(COLLECTION_DIR, `car_${String(index).padStart(3, "0")}`);
  const pngPath   = join(carDir, "nft.png");
  const glbPath   = join(carDir, "car.glb");

  if (!existsSync(pngPath) || !existsSync(glbPath)) {
    console.warn(`  [${index}] Missing nft.png or car.glb — skipping`);
    return;
  }

  const existing = FORCE ? {} : (cache[key] ?? {});

  // Pin image
  let imageCid = existing.image;
  if (!imageCid) {
    const buf   = readFileSync(pngPath);
    const fname = `chain-drift-car-${String(index).padStart(3, "0")}.png`;
    imageCid    = await pinFile(buf, fname, "image/png");
    console.log(`  [${index}] image  → ${imageCid}`);
  } else {
    console.log(`  [${index}] image  (cached)`);
  }

  // Pin model
  let modelCid = existing.model;
  if (!modelCid) {
    const buf   = readFileSync(glbPath);
    const fname = `chain-drift-car-${String(index).padStart(3, "0")}.glb`;
    modelCid    = await pinFile(buf, fname, "model/gltf-binary");
    console.log(`  [${index}] model  → ${modelCid}`);
  } else {
    console.log(`  [${index}] model  (cached)`);
  }

  // Metadata is NOT pinned individually — it is packaged as an IPFS directory
  // by scripts/pin-metadata-dir.mjs, which builds {folderCID}/{nonce} entries
  // after this script runs. CarNFT.tokenURI resolves {folderCID}/{tokenId}.

  cache[key] = { image: imageCid, model: modelCid };
  saveCache(cache);
}

// ─── Concurrency worker pool ─────────────────────────────────────────────────

async function runPool(items, concurrency, fn) {
  let i = 0;
  const results = { ok: 0, cached: 0, failed: 0 };
  async function worker() {
    while (i < items.length) {
      const item = items[i++];
      try {
        await fn(item);
        results.ok++;
      } catch (err) {
        console.error(`  [${item.index}] FAILED: ${err.message}`);
        results.failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ─── Main ────────────────────────────────────────────────────────────────────

console.log("Chain Drift — Collection Pinner");
console.log(`Concurrency: ${CONCURRENCY}  Force: ${FORCE}`);
console.log("─────────────────────────────────");

if (!existsSync(COLLECTION_JSON)) {
  console.error("collection.json not found at:", COLLECTION_JSON);
  process.exit(1);
}

const collection = JSON.parse(readFileSync(COLLECTION_JSON, "utf8"));
const cars       = (collection.cars ?? []).filter((c) => c.success);
console.log(`Cars to pin: ${cars.length}`);

const cache  = loadCache();
const start  = Date.now();
const result = await runPool(cars, CONCURRENCY, (car) => pinCar(car, cache));
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

// Write final manifest
generateManifest(cache, cars);

console.log("─────────────────────────────────");
console.log(`Done in ${elapsed}s`);
console.log(`  Processed: ${result.ok}`);
console.log(`  Failed:    ${result.failed}`);
console.log(`Cache:    ${CACHE_PATH}`);
console.log(`Manifest: ${MANIFEST_PATH}`);
