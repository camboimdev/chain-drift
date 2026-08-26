/**
 * IPFS CID Cache — Chain Drift
 *
 * Stores tokenId → IPFS CID mappings in a local JSON file so the metadata-api
 * can serve stable image URLs without hitting Pinata on every request.
 *
 * File location: DATA_DIR/ipfs-cache.json  (default: process.cwd())
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = process.env.DATA_DIR ?? process.cwd();
const CACHE_FILE = join(DATA_DIR, "ipfs-cache.json");

type CacheData = Record<string, string>; // tokenId (string) → CID

function load(): CacheData {
  if (!existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf8")) as CacheData;
  } catch {
    return {};
  }
}

function save(data: CacheData): void {
  writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), "utf8");
}

/** Get the IPFS CID for a token, or null if not yet pinned. */
export function getCid(tokenId: number): string | null {
  const data = load();
  return data[String(tokenId)] ?? null;
}

/** Persist a CID for a token. */
export function setCid(tokenId: number, cid: string): void {
  const data = load();
  data[String(tokenId)] = cid;
  save(data);
}

/** Return all cached entries as { tokenId, cid }[]. */
export function getAllCached(): { tokenId: number; cid: string }[] {
  const data = load();
  return Object.entries(data).map(([id, cid]) => ({
    tokenId: Number(id),
    cid,
  }));
}
