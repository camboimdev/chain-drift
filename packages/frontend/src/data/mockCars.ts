import type { CarNFT, PlayerGarage } from "@chain-drift/shared";
import { buildCarNFT } from "@chain-drift/shared";
import { getCarManifest } from "./collectionManifest";

function mockCar(tokenId: number, owner: string): CarNFT {
  const manifest = getCarManifest(tokenId);
  return buildCarNFT(tokenId, owner, {
    name:       manifest ? `Chain Drift #${String(tokenId).padStart(3, "0")}` : undefined,
    rarity:     manifest?.rarity,
    attributes: manifest?.attributes,
    modelUrl:   manifest?.model,
    imageUrl:   manifest?.image,
  });
}

// Player garage — tokens 1–5
export const mockCars: CarNFT[] = [1, 2, 3, 4, 5].map((id) =>
  mockCar(id, "player1")
);

export const playerGarage: PlayerGarage = {
  playerId: "player1",
  cars:     mockCars,
};

// AI opponents — tokens 6–25
export const aiOpponents: CarNFT[] = Array.from({ length: 20 }, (_, i) =>
  mockCar(i + 6, "ai")
);
