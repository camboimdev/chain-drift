#!/usr/bin/env node
/**
 * Pin Metadata Directory — Chain Drift
 *
 * Step 2 of the publishing flow (run after pin-collection.mjs).
 *
 * Reads scripts/collection/collection-cache.json for the current image +
 * model CIDs, injects full IPFS URLs into each car's metadata.json, then
 * uploads all metadata files to Pinata as ONE directory with files named by
 * token nonce ("1", "2", "3", ...).
 *
 * CarNFT.tokenURI appends the token ID to the base URI, resolving as:
 *   {collection_metadata_uri}/{nonce}
 *
 * After this script, set TOKEN_BASE_URI to "ipfs://{folderCID}/" in
 * packages/contracts/.env and run ONE transaction to point the collection at
 * the folder:
 *   pnpm --filter @chain-drift/contracts set-base-uri:base-sepolia
 *
 * Usage:
 *   node scripts/pin-metadata-dir.mjs
 *
 * Env (loaded from scripts/collection/.env):
 *   PINATA_API_KEY, PINATA_API_SECRET
 *   PIPELINE_COLLECTION_DIR — render pipeline output/collection folder
 *   IPFS_GATEWAY            — gateway used for the printed verification URLs
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

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ─── Load env ─────────────────────────────────────────────────────────────────

const envPath = join(ROOT, "scripts/collection/.env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const PINATA_API_KEY    = process.env.PINATA_API_KEY;
const PINATA_API_SECRET = process.env.PINATA_API_SECRET;
if (!PINATA_API_KEY || !PINATA_API_SECRET) {
  console.error("Missing PINATA_API_KEY or PINATA_API_SECRET in scripts/collection/.env");
  process.exit(1);
}

// Only used for the verification URLs printed at the end. The metadata itself
// carries `ipfs://` URIs so every consumer resolves them through its own
// gateway instead of depending on one that may be rate limited or down.
const IPFS_GATEWAY   = process.env.IPFS_GATEWAY ?? "https://gateway.pinata.cloud/ipfs";
// The render pipeline lives outside this repo; point PIPELINE_COLLECTION_DIR at
// its output/collection folder.
const COLLECTION_DIR = process.env.PIPELINE_COLLECTION_DIR
  ?? join(ROOT, "chain_drift_pipeline/output/collection");
const CACHE_PATH     = join(ROOT, "scripts/collection/collection-cache.json");

if (!existsSync(COLLECTION_DIR)) {
  console.error(`Collection dir not found: ${COLLECTION_DIR}`);
  console.error("Set PIPELINE_COLLECTION_DIR to the render pipeline output/collection folder.");
  process.exit(1);
}

// ─── Load collection cache ────────────────────────────────────────────────────

const cache = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
const nonces = Object.keys(cache).map(Number).sort((a, b) => a - b);
console.log(`Loaded ${nonces.length} entries from collection-cache.json`);

// ─── Build metadata entries ───────────────────────────────────────────────────

const entries = [];

for (const nonce of nonces) {
  const entry   = cache[String(nonce)];
  const carDir  = join(COLLECTION_DIR, `car_${String(nonce).padStart(3, "0")}`);
  const metaPath = join(carDir, "metadata.json");

  if (!existsSync(metaPath)) {
    console.warn(`  [${nonce}] metadata.json not found — skipping`);
    continue;
  }

  const raw = JSON.parse(readFileSync(metaPath, "utf8"));

  // Replace relative paths with the gateway-agnostic IPFS URIs from the cache.
  raw.image         = `ipfs://${entry.image}`;
  raw.animation_url = `ipfs://${entry.model}`;
  if (raw.properties?.files) {
    raw.properties.files = raw.properties.files.map((f) => {
      if (f.type === "image/png")         return { ...f, uri: `ipfs://${entry.image}` };
      if (f.type === "model/gltf-binary") return { ...f, uri: `ipfs://${entry.model}` };
      return f;
    });
  }

  entries.push({ nonce, json: raw });
}

console.log(`Built ${entries.length} metadata files`);

// ─── Pin directory to Pinata ──────────────────────────────────────────────────
// Pinata directory upload: POST /pinning/pinFileToIPFS with multiple `file`
// fields. The filename path determines directory structure.

const form = new FormData();

for (const { nonce, json } of entries) {
  const content = JSON.stringify(json, null, 2);
  const blob    = new Blob([content], { type: "application/json" });
  // Named just by nonce — no extension — so the explorer fetches /{nonce}
  form.append("file", blob, `chain-drift-metadata/${nonce}`);
}

form.append(
  "pinataMetadata",
  JSON.stringify({ name: "chain-drift-metadata-dir" })
);
form.append(
  "pinataOptions",
  JSON.stringify({ cidVersion: 1, wrapWithDirectory: false })
);

console.log("Uploading directory to Pinata...");

const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
  method: "POST",
  headers: {
    pinata_api_key:        PINATA_API_KEY,
    pinata_secret_api_key: PINATA_API_SECRET,
  },
  body: form,
});

if (!res.ok) {
  const text = await res.text();
  console.error(`Pinata upload failed (${res.status}): ${text}`);
  process.exit(1);
}

const result = await res.json();
const folderCid = result.IpfsHash;

console.log("");
console.log("✓ Directory pinned!");
console.log(`  CID: ${folderCid}`);
console.log(`  URL: ${IPFS_GATEWAY}/${folderCid}`);
console.log("");
console.log("Verify a token:");
console.log(`  ${IPFS_GATEWAY}/${folderCid}/6`);
console.log("");
console.log("Set on-chain (run this once):");
console.log(`  1. TOKEN_BASE_URI=ipfs://${folderCid}/   in packages/contracts/.env`);
console.log(`  2. pnpm --filter @chain-drift/contracts set-base-uri:base-sepolia`);

// Save the folder CID for reference
const out = { folderCid, metadataBaseUri: `${IPFS_GATEWAY}/${folderCid}`, count: entries.length };
writeFileSync(join(ROOT, "scripts/collection/metadata-dir.json"), JSON.stringify(out, null, 2));
console.log("");
console.log("Saved to scripts/collection/metadata-dir.json");
