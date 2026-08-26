// ─── Car Model Preloader ──────────────────────────────────────────────────
//
// GLB models live on IPFS, so a cold load can take several seconds per car.
// Every load goes through a single module-level cache keyed by model URL, so
// a car that was preloaded before the race renders instantly when mounted.
//
// The race gates its countdown on `preloadCarModels`, which is why that helper
// never rejects: a dead pin must not deadlock the start line.

import { GLTFLoader } from "three-stdlib";
import type { GLTF } from "three-stdlib";
import { fetchIpfs } from "../config/ipfs";
import { getCarManifest } from "../data/collectionManifest";

// One in-flight/completed load per model URL, shared by every car that uses it.
const modelCache = new Map<string, Promise<GLTF>>();

/**
 * Load a GLB through the IPFS gateway fallback chain and parse it.
 * Failures evict the cache entry so a later mount can retry.
 */
export function loadCarModel(modelUrl: string): Promise<GLTF> {
  let pending = modelCache.get(modelUrl);
  if (!pending) {
    pending = fetchIpfs(modelUrl).then(
      (buffer) =>
        new Promise<GLTF>((resolve, reject) => {
          new GLTFLoader().parse(buffer, "", resolve, reject);
        })
    );
    pending.catch(() => modelCache.delete(modelUrl));
    modelCache.set(modelUrl, pending);
  }
  return pending;
}

/**
 * Warm the cache for a set of car token ids, in parallel.
 *
 * Resolves once every model has settled — a failed model still counts toward
 * progress and falls back to the wireframe placeholder at render time, so a
 * broken pin delays the race by at most one gateway chain, never forever.
 */
export function preloadCarModels(
  tokenIds: number[],
  onProgress?: (loaded: number, total: number) => void
): Promise<void> {
  const urls = [
    ...new Set(
      tokenIds
        .map((tokenId) => getCarManifest(tokenId)?.model)
        .filter((model): model is string => Boolean(model))
    ),
  ];

  const total = urls.length;
  onProgress?.(0, total);
  if (total === 0) return Promise.resolve();

  let loaded = 0;
  return Promise.all(
    urls.map((url) =>
      loadCarModel(url)
        .catch((err) => {
          console.error(`[carModelPreloader] Could not preload ${url}:`, err);
        })
        .then(() => {
          loaded += 1;
          onProgress?.(loaded, total);
        })
    )
  ).then(() => undefined);
}
