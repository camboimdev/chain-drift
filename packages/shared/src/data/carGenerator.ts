import type { CarNFT, CarRarity } from "../types/car";

/**
 * Build a minimal CarNFT for a token whose full model/image URLs come from the
 * collection manifest (IPFS pre-pinned assets).
 */
export function buildCarNFT(
  tokenId: number,
  owner: string,
  options: {
    name?:       string;
    rarity?:     CarRarity;
    collection?: string;
    attributes?: { trait_type: string; value: string | number }[];
    modelUrl?:   string;
    imageUrl?:   string;
  } = {}
): CarNFT {
  const collectionPrefix = options.collection ? `${options.collection}-` : "";
  return {
    id:            `car-gen-${collectionPrefix}${tokenId}`,
    tokenId,
    collection:    options.collection,
    name:          options.name ?? `Chain Drift #${String(tokenId).padStart(3, "0")}`,
    owner,
    rarity:        options.rarity ?? "Common",
    attributes:    options.attributes,
    modelUrl:      options.modelUrl,
    imageUrl:      options.imageUrl,
  };
}
