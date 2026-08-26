/**
 * Collection Cache — Chain Drift
 *
 * Reads collection-cache.json (produced by scripts/pin-collection.mjs) and
 * returns the pre-pinned CIDs for each token.  Returns null gracefully if the
 * file is missing so the server falls back to on-the-fly metadata generation.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// collection-cache.json lives at the root of metadata-api/ (one level up from src/)
const CACHE_FILE = join(__dirname, "..", "collection-cache.json");

export interface CollectionEntry {
  image:    string; // IPFS CID for nft.png
  model:    string; // IPFS CID for car.glb
  metadata: string; // IPFS CID for metadata.json
}

type CacheData = Record<string, CollectionEntry>;

let _cache: CacheData | null = null;

function loadCache(): CacheData {
  if (_cache !== null) return _cache;
  if (!existsSync(CACHE_FILE)) {
    _cache = {};
    return _cache;
  }
  try {
    _cache = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as CacheData;
  } catch {
    _cache = {};
  }
  return _cache;
}

/** Return the collection entry for a token, or null if not pinned. */
export function getCollectionEntry(tokenId: number): CollectionEntry | null {
  const data = loadCache();
  return data[String(tokenId)] ?? null;
}
