import { useEffect, useState } from "react";
import type { CarNFT } from "@chain-drift/shared";
import { buildCarNFT } from "@chain-drift/shared";
import { getCarManifest } from "./data/collectionManifest";
import { Garage } from "./components/Garage";
import { LeaderboardScreen } from "./components/LeaderboardScreen";
import { LoginPage } from "./components/LoginPage";
import { OnboardingFlow } from "./components/OnboardingFlow";
import { RaceScene } from "./components/RaceScene";
import { RaceMultiplayerLobby } from "./components/RaceMultiplayerLobby";
import { RaceWaitingRoom } from "./components/RaceWaitingRoom";
import { WalletProvider } from "./context/WalletContext";
import { Web3Provider } from "./providers/Web3Provider";
import { useWallet } from "./context/walletContextValue";
import { fetchPlayerCars } from "./services/fetchPlayerCars";
import type { RaceFinish } from "./services/raceContract";

type AppView =
  | "garage"
  | "leaderboard"    // all-time standings
  | "lobby"          // multiplayer race browser
  | "waiting"        // waiting room after joining a race
  | "race";          // 3D replay of the settled race

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
  // The settled race, straight from `RaceFinished`: finish order and payouts
  const [raceFinish, setRaceFinish] = useState<RaceFinish | null>(null);

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
  }, [state, wallet?.address]);

  useEffect(() => {
    if (user?.isNewUser && !showOnboarding) {
      setShowOnboarding(true);
    }
  }, [user?.isNewUser, showOnboarding]);

  if (showOnboarding) {
    return <OnboardingFlow onComplete={() => setShowOnboarding(false)} />;
  }

  if (state === "disconnected" || state === "error" || state === "connecting") {
    return <LoginPage />;
  }

  const handleStartRace = (carId: string) => {
    const car = playerCars.find((c) => c.id === carId) ?? playerCars[0];
    if (!car) return;
    setSelectedCarForRace(car);
    setCurrentView("lobby");
  };

  const handleJoinedRace = (raceId: bigint, entryFee: bigint) => {
    setWaitingState({ raceId, entryFee });
    setCurrentView("waiting");
  };

  const handleRaceResolved = (finish: RaceFinish) => {
    setRaceFinish(finish);
    setCurrentView("race");
  };

  const handleReturnToGarage = () => {
    setCurrentView("garage");
    setSelectedCarForRace(null);
    setWaitingState(null);
    setRaceFinish(null);
  };

  // Straight back to the lobby with the same car, skipping the garage.
  const handleRaceAgain = () => {
    setWaitingState(null);
    setRaceFinish(null);
    setCurrentView(selectedCarForRace ? "lobby" : "garage");
  };

  // ── Leaderboard ────────────────────────────────────────────────────────
  if (currentView === "leaderboard") {
    return (
      <LeaderboardScreen
        walletAddress={wallet?.address ?? ""}
        onClose={handleReturnToGarage}
      />
    );
  }

  // ── Lobby ──────────────────────────────────────────────────────────────
  if (currentView === "lobby" && selectedCarForRace) {
    return (
      <RaceMultiplayerLobby
        playerCar={selectedCarForRace}
        walletAddress={wallet?.address ?? ""}
        onJoinedRace={handleJoinedRace}
        onCancel={handleReturnToGarage}
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

  // ── 3D replay of the settled race ──────────────────────────────────────
  if (currentView === "race" && selectedCarForRace && raceFinish && waitingState) {
    // `RaceFinished` lists the cars in finish order alongside the DRIFT each
    // was credited. Both are handed to the scene so the animation and the
    // results screen agree with the chain.
    const raceCars: CarNFT[] = raceFinish.carTokenIds.map((id, i) => {
      const tokenId = Number(id);
      if (tokenId === selectedCarForRace.tokenId) return selectedCarForRace;
      const manifest = getCarManifest(tokenId);
      return buildCarNFT(tokenId, raceFinish.players[i], {
        rarity:     manifest?.rarity,
        attributes: manifest?.attributes,
        modelUrl:   manifest?.model,
        imageUrl:   manifest?.image,
      });
    });

    return (
      <RaceScene
        cars={raceCars}
        userCarId={selectedCarForRace.id}
        raceId={waitingState.raceId}
        entryFee={waitingState.entryFee}
        outcome={{
          carTokenIds: raceFinish.carTokenIds.map(Number),
          payouts: [...raceFinish.payouts],
        }}
        onReturnToGarage={handleReturnToGarage}
        onRaceAgain={handleRaceAgain}
      />
    );
  }

  // ── Garage ─────────────────────────────────────────────────────────────
  return (
    <Garage
      cars={playerCars}
      loading={carsLoading}
      playerId={user?.walletAddress || wallet?.address || "unknown"}
      onStartRace={handleStartRace}
      onMintSuccess={() => wallet?.address && loadCars(wallet.address)}
      onOpenLeaderboard={() => setCurrentView("leaderboard")}
    />
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
