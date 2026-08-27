import type { CarRarity } from "@chain-drift/shared";

/** Chain Drift surface tokens. Monochrome by default; one accent, never two. */
export const DS = {
  bg:            "#000000",
  bgAlt:         "#0A0A0A",
  surface:       "#111111",
  divider:       "#1A1A1A",
  border:        "#2A2A2A",
  textPrimary:   "#FFFFFF",
  textSecondary: "#E5E5E5",
  textMeta:      "#BFBFBF",
  textDisabled:  "#3A3A3A",
  accent:        "#00FF88",
  font:          "'JetBrains Mono', monospace",
} as const;

/** The same typeface the HUD uses, for text rendered inside the 3D scene. */
export const FONT_BOLD    = "/fonts/JetBrainsMono-700.ttf";
export const FONT_REGULAR = "/fonts/JetBrainsMono-400.ttf";

/**
 * Rarity is brightness, never hue — a Legendary is a brighter white, not a
 * gold one. These multipliers drive the scan-pad ring, the key light and the
 * label colour, so a rarity reads the same in the scene and in the HUD.
 */
export const RARITY_BRIGHTNESS: Record<CarRarity, number> = {
  Common:    0.30,
  Rare:      0.52,
  Epic:      0.78,
  Legendary: 1.0,
};

/** Only the top tier animates — a room where everything pulses reads as noise. */
export const RARITY_PULSES: Record<CarRarity, boolean> = {
  Common:    false,
  Rare:      false,
  Epic:      false,
  Legendary: true,
};

export function rarityTextColor(rarity: CarRarity): string {
  switch (rarity) {
    case "Legendary": return DS.textPrimary;
    case "Epic":      return DS.textSecondary;
    case "Rare":      return DS.textMeta;
    default:          return DS.textDisabled;
  }
}

/** `#0042` — the token as the collection prints it. */
export function tokenLabel(tokenId: number): string {
  return `#${String(tokenId).padStart(4, "0")}`;
}

export function shortAddress(address: string): string {
  return address.length > 14
    ? `${address.slice(0, 8)}…${address.slice(-4)}`
    : address;
}

/** The archetype trait the manifest publishes — the closest thing to a model name. */
export function archetypeOf(car: { attributes?: { trait_type: string; value: string | number }[] }): string {
  const trait = car.attributes?.find((a) => a.trait_type === "Archetype");
  return trait === undefined ? "UNCLASSIFIED" : String(trait.value).toUpperCase();
}

/** A named trait, uppercased, or a dash when the token does not carry it. */
export function traitOf(
  car: { attributes?: { trait_type: string; value: string | number }[] },
  traitType: string
): string {
  const trait = car.attributes?.find((a) => a.trait_type === traitType);
  return trait === undefined ? "—" : String(trait.value).toUpperCase();
}
