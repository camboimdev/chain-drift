// ─── On-chain car data ────────────────────────────────────────────────────
//
// Reads the CarNFT contract for the tokens a wallet owns, then builds each
// CarNFT from the collection manifest (IPFS pre-pinned GLB/PNG).

import type { CarNFT } from "@chain-drift/shared";
import { buildCarNFT } from "@chain-drift/shared";
import { CAR_NFT_ADDRESS, USE_MOCK_FALLBACK } from "../config/chain";
import { getCarManifest } from "../data/collectionManifest";
import { mockCars } from "../data/mockCars";
import { fetchOwnedTokenIds } from "./carNft";

/**
 * Build a CarNFT from a token ID, pulling name/rarity/attributes from the
 * collection manifest and falling back to sensible defaults if not found.
 */
function buildCarFromManifest(tokenId: number, owner: string): CarNFT {
  const manifest = getCarManifest(tokenId);
  return buildCarNFT(tokenId, owner, {
    name: manifest ? `Chain Drift #${String(tokenId).padStart(3, "0")}` : undefined,
    rarity: manifest?.rarity,
    collection: CAR_NFT_ADDRESS,
    attributes: manifest?.attributes,
    modelUrl: manifest?.model,
    imageUrl: manifest?.image,
  });
}

/**
 * Every Car NFT owned by `address`.
 *
 * Falls back to mock cars when the contract address is unset (pre-deployment),
 * the read fails, or the wallet owns nothing and `USE_MOCK_FALLBACK` is on.
 */
export async function fetchPlayerCars(address: `0x${string}`): Promise<CarNFT[]> {
  if (!CAR_NFT_ADDRESS) {
    console.warn(
      "[fetchPlayerCars] VITE_CAR_NFT_ADDRESS is unset — using mock cars. " +
        "Deploy the contracts and set it in .env.local."
    );
    return USE_MOCK_FALLBACK ? mockCars : [];
  }

  try {
    const tokenIds = await fetchOwnedTokenIds(address);

    if (tokenIds.length === 0 && USE_MOCK_FALLBACK) {
      console.info("[fetchPlayerCars] No on-chain cars found — using mock cars.");
      return mockCars;
    }

    return tokenIds.map((tokenId) => buildCarFromManifest(Number(tokenId), address));
  } catch (err) {
    console.error("[fetchPlayerCars] Failed to fetch on-chain cars:", err);
    return USE_MOCK_FALLBACK ? mockCars : [];
  }
}

export { fetchEquippedParts } from "./carNft";
