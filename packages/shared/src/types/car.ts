export type CarRarity = "Common" | "Rare" | "Epic" | "Legendary";

export type PartCategory =
  | "Main Body"
  | "Wheels & Suspension"
  | "Front Visual"
  | "Rear Visual"
  | "Windows"
  | "Interior"
  | "Aesthetic"
  | "Performance";

export type PartType =
  // 1. Main Body Structure
  | "Chassis"
  | "BodyShell"
  | "FrontBumper"
  | "RearBumper"
  | "Hood"
  | "LeftDoor"
  | "RightDoor"
  | "Roof"
  | "Trunk"
  | "Spoiler"
  // 2. Wheels & Suspension
  | "FrontLeftWheel"
  | "FrontRightWheel"
  | "RearLeftWheel"
  | "RearRightWheel"
  | "Tires"
  | "FrontSuspension"
  | "RearSuspension"
  // 3. Front Visual Components
  | "LeftHeadlight"
  | "RightHeadlight"
  | "FrontGrille"
  | "FrontAirIntake"
  | "Emblem"
  // 4. Rear Visual Components
  | "LeftTailLight"
  | "RightTailLight"
  | "Exhaust"
  // 5. Windows / Glass
  | "FrontWindshield"
  | "RearWindshield"
  | "LeftSideWindow"
  | "RightSideWindow"
  | "DoorWindows"
  // 6. Interior
  | "SteeringWheel"
  | "Dashboard"
  | "FrontSeats"
  | "RearSeats"
  | "CenterConsole"
  // 7. Aesthetic Customization
  | "Paint"
  | "FrontDecal"
  | "SideDecal"
  | "RearDecal"
  | "WheelColor"
  | "WindowTint"
  | "NeonUnderglow"
  // 8. Engine & Performance Parts
  | "EngineBlock"
  | "Turbo"
  | "AirIntake"
  | "Radiator"
  | "Nitro";

export interface CarPart {
  id: string;
  type: PartType;
  name: string;
  rarity: CarRarity;
  description?: string;
  // Visual parameters for rendering
  visualParams: {
    color?: string; // For Body/Wheels
    modelPath?: string; // If we had different models
    texturePath?: string;
    metalness?: number;
    roughness?: number;
    scale?: [number, number, number];
    positionOffset?: [number, number, number];
    rotationOffset?: [number, number, number];
    // Specific attributes
    rimColor?: string;
    width?: number; // For spoilers/wheels
  };
  // Stats for gameplay (future proofing)
  stats?: {
    speed?: number;
    acceleration?: number;
    handling?: number;
  };
  price?: number; // In-game currency
}

export interface CarNFT {
  id: string;
  tokenId: number;
  collection?: string;
  name: string;
  owner: string;
  rarity: CarRarity;

  // Parts (may be empty for collection-based cars)
  equippedParts: Partial<Record<PartType, CarPart>>;

  // Collection manifest fields (populated from IPFS/collection-cache)
  attributes?: { trait_type: string; value: string | number }[];
  modelUrl?:   string; // IPFS GLB URL
  imageUrl?:   string; // IPFS PNG URL

  // Computed/cached visual snapshot (optional)
  previewImage?: string;
}

export interface PlayerGarage {
  playerId: string;
  cars: CarNFT[];
}
