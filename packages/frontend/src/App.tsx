import { useEffect, useState } from "react";
import type { CarNFT } from "@chain-drift/shared";
import { buildCarNFT } from "@chain-drift/shared";
import { getCarManifest } from "./data/collectionManifest";
import { Garage } from "./components/Garage";
import { LoginPage } from "./components/LoginPage";
import { OnboardingFlow } from "./components/OnboardingFlow";
import { RaceScene } from "./components/RaceScene";
import { RaceMultiplayerLobby } from "./components/RaceMultiplayerLobby";
import { RaceWaitingRoom } from "./components/RaceWaitingRoom";
import { WalletProvider } from "./context/WalletContext";
import { Web3Provider } from "./providers/Web3Provider";
import { useWallet } from "./context/WalletContext";
import { fetchPlayerCars } from "./services/fetchPlayerCars";
import type { OnChainParticipant } from "./services/raceContract";
import { aiOpponents } from "./data/mockCars";

type AppView =
  | "garage"
  | "lobby"         // multiplayer race browser
  | "waiting"       // waiting room after joining a race
  | "race";         // 3D race animation

interface WaitingRoomState {
  raceId: bigint;
  entryFee: bigint;
}

function AppContent() {
  const { wallet, user, state } = useWallet();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [currentView, setCurrentView] = useState<AppView>("garage");
  const [selectedCarForRace, setSelectedCarForRace] = useState<CarNFT | null>(null);
  const [playerCars, setPlayerCars] = useState<CarNFT[]>([]);
  const [carsLoading, setCarsLoading] = useState(false);
  const [waitingState, setWaitingState] = useState<WaitingRoomState | null>(null);
  // On-chain participants passed to the 3D race for correct finish order
  const [onChainParticipants, setOnChainParticipants] = useState<OnChainParticipant[]>([]);

  const loadCars = (address: `0x${string}`) => {
    setCarsLoading(true);
    fetchPlayerCars(address)
      .then(setPlayerCars)
      .finally(() => setCarsLoading(false));
  };

  useEffect(() => {
    if (state === "connected" && wallet?.address) {
      loadCars(wallet.address);
    } else {
      setPlayerCars([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, wallet?.address]);

  useEffect(() => {
    if (user?.isNewUser && !showOnboarding) {
      setShowOnboarding(true);
    }
  }, [user?.isNewUser, showOnboarding]);

  if (showOnboarding) {
    return <OnboardingFlow onComplete={() => setShowOnboarding(false)} />;
  }

  if (state === "disconnected" || state === "error") {
    return <LoginPage />;
  }

  if (state === "connecting" || carsLoading) {
    return <LoginPage />;
  }

  const handleStartRace = (carId: string) => {
    const car = playerCars.find((c) => c.id === carId) ?? playerCars[0];
    setSelectedCarForRace(car ?? null);
    setCurrentView("lobby");
  };

  const handleJoinedRace = (raceId: bigint, entryFee: bigint) => {
    setWaitingState({ raceId, entryFee });
    setCurrentView("waiting");
  };

  const handleRaceResolved = (participants: OnChainParticipant[]) => {
    setOnChainParticipants(participants);
    setCurrentView("race");
  };

  const handleReturnToGarage = () => {
    setCurrentView("garage");
    setSelectedCarForRace(null);
    setWaitingState(null);
    setOnChainParticipants([]);
  };

  // ── Lobby ──────────────────────────────────────────────────────────────
  if (currentView === "lobby" && selectedCarForRace) {
    return (
      <RaceMultiplayerLobby
        playerCar={selectedCarForRace}
        walletAddress={wallet?.address ?? ""}
        onJoinedRace={handleJoinedRace}
      />
    );
  }

  // ── Waiting room ───────────────────────────────────────────────────────
  if (currentView === "waiting" && waitingState && selectedCarForRace) {
    return (
      <RaceWaitingRoom
        raceId={waitingState.raceId}
        entryFee={waitingState.entryFee}
        walletAddress={wallet?.address ?? ""}
        onRaceResolved={handleRaceResolved}
        onCancel={handleReturnToGarage}
      />
    );
  }

  // ── 3D Race ────────────────────────────────────────────────────────────
  if (currentView === "race" && selectedCarForRace) {
    // Build the car grid: map on-chain participants to CarNFT objects.
    // If on-chain participants are available, use their order (finish order from VRF).
    // Pad with AI opponents if needed.
    const raceCars: CarNFT[] = onChainParticipants.length > 0
      ? onChainParticipants.map((p) => {
          const tokenId = Number(p.carTokenId);
          if (tokenId === selectedCarForRace.tokenId) return selectedCarForRace;
          const manifest = getCarManifest(tokenId);
          return buildCarNFT(tokenId, p.owner, {
            rarity:     manifest?.rarity,
            attributes: manifest?.attributes,
            modelUrl:   manifest?.model,
            imageUrl:   manifest?.image,
          });
        })
      : [selectedCarForRace, ...aiOpponents.slice(0, 3)];

    return (
      <RaceScene
        cars={raceCars}
        userCarId={selectedCarForRace.id}
        onReturnToGarage={handleReturnToGarage}
      />
    );
  }

  // ── Garage ─────────────────────────────────────────────────────────────
  return (
    <div className="relative">
      <Garage
        cars={playerCars}
        playerId={user?.walletAddress || wallet?.address || "unknown"}
        onStartRace={handleStartRace}
        onMintSuccess={() => wallet?.address && loadCars(wallet.address)}
      />
    </div>
  );
}

function App() {
  return (
    <Web3Provider>
      <WalletProvider>
        <div className="App">
          <AppContent />
        </div>
      </WalletProvider>
    </Web3Provider>
  );
}

export default App;
