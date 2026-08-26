/**
 * Metadata API — Chain Drift
 *
 * Serves ERC-721 metadata JSON for each car token so marketplaces and
 * wallets can display car name, image, and attributes.
 *
 * CarNFT.tokenURI is `<baseURI><tokenId>`, so point the contract's base URI
 * at this service's /metadata/ path (or at a pinned IPFS folder).
 *
 * GET  /metadata/:tokenId  → NFT metadata JSON (ERC-721 / OpenSea shape)
 * GET  /pin/:tokenId       → return pre-pinned CIDs from collection cache (or 404)
 * GET  /health             → 200 OK
 *
 * Environment variables:
 *   PORT              — HTTP port (default 3001)
 *   IPFS_GATEWAY      — Gateway prefix for image URLs (default https://ipfs.io/ipfs)
 *   COLLECTION_JSON_PATH — Path to collection.json (optional; falls back to built-in path)
 *   PINATA_API_KEY    — Pinata API key (kept for possible future use)
 *   PINATA_API_SECRET — Pinata API secret (kept for possible future use)
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getCollectionEntry } from "./collection-cache.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT         = Number(process.env.PORT ?? 3001);
const IPFS_GATEWAY = process.env.IPFS_GATEWAY ?? "https://ipfs.io/ipfs";

// ─── Collection JSON (loaded once at startup) ─────────────────────────────────

interface CollectionCar {
  index:      number;
  name:       string;
  archetype:  string;
  neon_color: string;
  rarity:     string;
  success:    boolean;
  nft_image?: string;
}

interface CollectionJson {
  cars: CollectionCar[];
}

const DEFAULT_COLLECTION_JSON = join(
  __dirname,
  "../../../../chain_drift_pipeline/output/collection/collection.json"
);
const COLLECTION_JSON_PATH =
  process.env.COLLECTION_JSON_PATH ?? DEFAULT_COLLECTION_JSON;

const collectionMap = new Map<number, CollectionCar>();

if (existsSync(COLLECTION_JSON_PATH)) {
  try {
    const raw = JSON.parse(readFileSync(COLLECTION_JSON_PATH, "utf8")) as CollectionJson;
    for (const car of raw.cars ?? []) {
      collectionMap.set(car.index, car);
    }
    console.log(`[metadata-api] Loaded ${collectionMap.size} cars from collection.json`);
  } catch (err) {
    console.warn("[metadata-api] Failed to parse collection.json:", err);
  }
} else {
  console.warn("[metadata-api] collection.json not found at:", COLLECTION_JSON_PATH);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseTokenId(url: string, prefix: string): number | null {
  const pattern = new RegExp(`^${prefix}/(\\d+)$`);
  const match = url.match(pattern);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function respond(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": status === 200 ? "public, max-age=3600" : "no-store",
  });
  res.end(json);
}

// ─── Metadata builder ─────────────────────────────────────────────────────────

function buildMetadata(tokenId: number) {
  const entry     = getCollectionEntry(tokenId);
  const carData   = collectionMap.get(tokenId);

  if (entry) {
    // Build rich metadata from the pre-generated collection
    const attributes: { trait_type: string; value: string | number }[] = [
      { trait_type: "Archetype",  value: carData?.archetype  ?? "Unknown" },
      { trait_type: "Neon Color", value: carData?.neon_color ?? "unknown" },
      { trait_type: "Rarity",     value: carData?.rarity     ?? "Common"  },
      { trait_type: "Token ID",   value: tokenId },
    ];

    return {
      name:          carData?.name ?? `Chain Drift #${String(tokenId).padStart(3, "0")}`,
      description:   "A Retro Cyberpunk Drift car from the Chain Drift Genesis collection.",
      image:         `${IPFS_GATEWAY}/${entry.image}`,
      animation_url: `${IPFS_GATEWAY}/${entry.model}`,
      external_url:  "https://chaindrift.io",
      attributes,
      properties: {
        files: [
          { uri: `${IPFS_GATEWAY}/${entry.image}`, type: "image/png" },
          { uri: `${IPFS_GATEWAY}/${entry.model}`, type: "model/gltf-binary" },
        ],
        category: "vr",
      },
    };
  }

  // Fallback: minimal metadata without image
  return {
    name:        carData?.name ?? `Chain Drift #${String(tokenId).padStart(3, "0")}`,
    description: "A Retro Cyberpunk Drift car from the Chain Drift Genesis collection.",
    attributes:  [
      { trait_type: "Rarity",   value: carData?.rarity ?? "Common" },
      { trait_type: "Token ID", value: tokenId },
    ],
  };
}

// ─── Request handler ──────────────────────────────────────────────────────────

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url    = req.url ?? "/";
  const method = req.method ?? "GET";

  if (url === "/health") {
    return respond(res, 200, { status: "ok" });
  }

  // GET /metadata/:tokenId
  const metaTokenId = parseTokenId(url, "/metadata");
  if (metaTokenId !== null && method === "GET") {
    try {
      respond(res, 200, buildMetadata(metaTokenId));
    } catch (err) {
      console.error(`[metadata-api] Error for token ${metaTokenId}:`, err);
      respond(res, 500, { error: "Internal error" });
    }
    return;
  }

  // GET /pin/:tokenId — return pre-pinned CIDs from collection cache
  const pinTokenId = parseTokenId(url, "/pin");
  if (pinTokenId !== null && method === "GET") {
    const entry = getCollectionEntry(pinTokenId);
    if (!entry) return respond(res, 404, { error: "Not pinned" });
    return respond(res, 200, {
      tokenId:  pinTokenId,
      image:    `${IPFS_GATEWAY}/${entry.image}`,
      model:    `${IPFS_GATEWAY}/${entry.model}`,
      metadata: `${IPFS_GATEWAY}/${entry.metadata}`,
    });
  }

  respond(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`[metadata-api] Listening on http://localhost:${PORT}`);
  console.log(`[metadata-api] GET  /metadata/:tokenId`);
  console.log(`[metadata-api] GET  /pin/:tokenId  (pre-pinned CIDs)`);
});
