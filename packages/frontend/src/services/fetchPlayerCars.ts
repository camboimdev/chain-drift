// ─── On-chain car data ────────────────────────────────────────────────────
//
// Reads the CarNFT contract for the tokens a wallet owns, then builds each
// CarNFT from the collection manifest (IPFS pre-pinned GLB/PNG).

import type { CarNFT } from "@chain-drift/shared";
import { buildCarNFT } from "@chain-drift/shared";
import { CAR_NFT_ADDRESS } from "../config/chain";
import { getCarManifest } from "../data/collectionManifest";
import { fetchOwnedTokenIds } from "./carNft";

/**
 * Build a CarNFT from a token ID, pulling rarity and attributes from the
 * collection manifest and falling back to sensible defaults if not found.
 */
function buildCarFromManifest(tokenId: number, owner: string): CarNFT {
  const manifest = getCarManifest(tokenId);
  return buildCarNFT(tokenId, owner, {
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
 * An empty garage is a real answer, not a failure: a new wallet owns nothing
 * until it mints, and the garage's empty state is what tells it so.
 */
export async function fetchPlayerCars(address: `0x${string}`): Promise<CarNFT[]> {
  if (!CAR_NFT_ADDRESS) {
    console.warn(
      "[fetchPlayerCars] VITE_CAR_NFT_ADDRESS is unset — deploy the contracts " +
        "and set it in .env.local."
    );
    return [];
  }

  try {
    const tokenIds = await fetchOwnedTokenIds(address);
    return tokenIds.map((tokenId) => buildCarFromManifest(Number(tokenId), address));
  } catch (err) {
    console.error("[fetchPlayerCars] Failed to fetch on-chain cars:", err);
    return [];
  }
}

export { fetchEquippedParts } from "./carNft";
