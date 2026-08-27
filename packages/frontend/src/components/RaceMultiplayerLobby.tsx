/**
 * RaceMultiplayerLobby — on-chain race room browser.
 *
 * Shows open races from the Race Escrow contract.
 * Player can create a new race or join an existing one.
 * Entry fee is paid in DRIFT through the connected EVM wallet.
 */

import { useEffect, useState, useCallback } from "react";
import type { CarNFT } from "@chain-drift/shared";
import { formatDrift, RACE_ENTRY_FEE } from "@chain-drift/shared";
import type { OnChainRace } from "../services/raceContract";
import { getOpenRaces, createRace, enterRace } from "../services/raceContract";

const DS = {
  bg: "#000000",
  surface: "#0D0D0D",
  border: "#1A1A1A",
  accent: "#00FF88",
  textPrimary: "#FFFFFF",
  textMeta: "#BFBFBF",
  textDisabled: "#3A3A3A",
  font: "'JetBrains Mono', monospace",
} as const;

interface RaceMultiplayerLobbyProps {
  playerCar: CarNFT;
  walletAddress: string;
  /** Called after successfully entering a race — passes the race_id */
  onJoinedRace: (raceId: bigint, entryFee: bigint) => void;
  onCancel: () => void;
}

export function RaceMultiplayerLobby({
  playerCar,
  walletAddress,
  onJoinedRace,
  onCancel,
}: RaceMultiplayerLobbyProps) {
  const [openRaces, setOpenRaces] = useState<OnChainRace[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [joiningId, setJoiningId] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  const carTokenId = playerCar.tokenId;

  const refreshRaces = useCallback(async () => {
    try {
      const races = await getOpenRaces(10, 30);
      setOpenRaces(races);
    } catch (e) {
      console.error("[Lobby] Failed to fetch races:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshRaces();
    const interval = setInterval(refreshRaces, 5000);
    return () => clearInterval(interval);
  }, [refreshRaces]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      await createRace(RACE_ENTRY_FEE, 4);
      // After creating, refresh and the new race will appear — then auto-join
      await refreshRaces();
      // Find the freshest open race (highest id) and join it
      const fresh = await getOpenRaces(1, 5);
      if (fresh.length > 0) {
        await doJoin(fresh[0].id, fresh[0].entryFee);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
      setError(msg);
    } finally {
      setCreating(false);
    }
  };

  const doJoin = async (raceId: bigint, entryFee: bigint) => {
    setJoiningId(raceId);
    setError(null);
    try {
      await enterRace(walletAddress as `0x${string}`, raceId, BigInt(carTokenId), entryFee);
      onJoinedRace(raceId, entryFee);
    } catch (e) {
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
      setError(msg);
      setJoiningId(null);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: DS.bg,
        fontFamily: DS.font,
        color: DS.textPrimary,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div
          style={{
            fontSize: 9,
            letterSpacing: "0.4em",
            color: DS.accent,
            marginBottom: 8,
          }}
        >
          CHAIN DRIFT
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "0.1em" }}>
          RACE LOBBY
        </div>
        <div
          style={{
            fontSize: 8,
            color: DS.textDisabled,
            letterSpacing: "0.2em",
            marginTop: 6,
          }}
        >
          {walletAddress.slice(0, 12)}...{walletAddress.slice(-6)} ·{" "}
          {playerCar.name}
        </div>
      </div>

      {/* Race list */}
      <div style={{ width: "100%", maxWidth: 540, marginBottom: 24 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <span
            style={{
              fontSize: 8,
              letterSpacing: "0.25em",
              color: DS.textDisabled,
            }}
          >
            OPEN RACES
          </span>
          <button
            onClick={refreshRaces}
            style={{
              background: "none",
              border: "none",
              color: DS.textDisabled,
              fontSize: 8,
              letterSpacing: "0.15em",
              cursor: "pointer",
              fontFamily: DS.font,
            }}
          >
            REFRESH
          </button>
        </div>

        {loading ? (
          <div
            style={{
              textAlign: "center",
              color: DS.textDisabled,
              fontSize: 9,
              letterSpacing: "0.2em",
              padding: 32,
            }}
          >
            SCANNING CHAIN...
          </div>
        ) : openRaces.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              border: `1px solid ${DS.border}`,
              padding: 32,
              color: DS.textDisabled,
              fontSize: 9,
              letterSpacing: "0.2em",
            }}
          >
            NO OPEN RACES — CREATE ONE
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {openRaces.map((race) => (
              <RaceRow
                key={race.id}
                race={race}
                joining={joiningId === race.id}
                onJoin={() => doJoin(race.id, race.entryFee)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            width: "100%",
            maxWidth: 540,
            border: "1px solid #FF4444",
            padding: "10px 14px",
            marginBottom: 16,
            fontSize: 8,
            letterSpacing: "0.15em",
            color: "#FF4444",
          }}
        >
          {error}
        </div>
      )}

      {/* Create race */}
      <div style={{ width: "100%", maxWidth: 540 }}>
        <button
          onClick={handleCreate}
          disabled={creating || joiningId !== null}
          style={{
            width: "100%",
            padding: "16px",
            background: creating ? DS.surface : DS.accent,
            border: "none",
            color: creating ? DS.textDisabled : "#000000",
            fontFamily: DS.font,
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.3em",
            cursor: creating || joiningId !== null ? "not-allowed" : "pointer",
            transition: "background 150ms",
          }}
        >
          {creating ? "CREATING RACE..." : `CREATE RACE · ${formatDrift(RACE_ENTRY_FEE)} DRIFT ENTRY`}
        </button>

        <div
          style={{
            marginTop: 10,
            fontSize: 7,
            color: DS.textDisabled,
            letterSpacing: "0.15em",
            textAlign: "center",
          }}
        >
          ENTRY FEE LOCKED IN SMART CONTRACT · PAID OUT BY ON-CHAIN VRF
        </div>

        <button
          onClick={onCancel}
          disabled={creating || joiningId !== null}
          style={{
            width: "100%",
            marginTop: 16,
            padding: "12px",
            background: "transparent",
            border: `1px solid ${DS.border}`,
            color: DS.textDisabled,
            fontFamily: DS.font,
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: "0.2em",
            cursor: creating || joiningId !== null ? "not-allowed" : "pointer",
          }}
        >
          BACK TO GARAGE
        </button>
      </div>
    </div>
  );
}

function RaceRow({
  race,
  joining,
  onJoin,
}: {
  race: OnChainRace;
  joining: boolean;
  onJoin: () => void;
}) {
  const slots = race.participantCount;
  const max = race.maxParticipants;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        border: `1px solid ${DS.border}`,
        padding: "12px 16px",
        gap: 12,
      }}
    >
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.15em",
            marginBottom: 4,
          }}
        >
          RACE #{race.id}
        </div>
        <div
          style={{
            fontSize: 7,
            color: DS.textDisabled,
            letterSpacing: "0.15em",
          }}
        >
          {formatDrift(race.entryFee)} DRIFT ENTRY
        </div>
      </div>

      {/* Slot indicators */}
      <div style={{ display: "flex", gap: 4 }}>
        {Array.from({ length: max }).map((_, i) => (
          <div
            key={i}
            style={{
              width: 10,
              height: 10,
              background: i < slots ? DS.accent : DS.border,
            }}
          />
        ))}
      </div>

      <div
        style={{
          fontSize: 8,
          color: DS.textMeta,
          letterSpacing: "0.1em",
          minWidth: 32,
          textAlign: "right",
        }}
      >
        {slots}/{max}
      </div>

      <button
        onClick={onJoin}
        disabled={joining}
        style={{
          padding: "8px 18px",
          background: "transparent",
          border: `1px solid ${DS.textPrimary}`,
          color: joining ? DS.textDisabled : DS.textPrimary,
          fontFamily: DS.font,
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: "0.2em",
          cursor: joining ? "not-allowed" : "pointer",
        }}
      >
        {joining ? "..." : "JOIN"}
      </button>
    </div>
  );
}
