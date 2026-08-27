export type CarRarity = "Common" | "Rare" | "Epic" | "Legendary";

export interface CarNFT {
  id: string;
  tokenId: number;
  collection?: string;
  name: string;
  owner: string;
  rarity: CarRarity;

  /** Traits from the collection manifest — Archetype, Neon Color, Rarity. */
  attributes?: { trait_type: string; value: string | number }[];
  /** IPFS GLB URL. */
  modelUrl?: string;
  /** IPFS PNG URL. */
  imageUrl?: string;
}
