// ─── Leaderboard Contract Interactions ────────────────────────────────────
//
// The escrow cannot write these itself — the payout runs inside a VRF callback
// with a fixed gas limit — so an off-chain recorder watches `RaceFinished` and
// calls `recordResult`. Everything here is a read of what it wrote.

import { leaderboardAbi } from "@chain-drift/shared";
import { readContract } from "@wagmi/core";
import { LEADERBOARD_ADDRESS, requireAddress } from "../config/chain";
import { wagmiConfig } from "../config/wagmi";

export interface PlayerStats {
  address: `0x${string}`;
  wins: number;
  races: number;
  /** All-time DRIFT credited to this player, in wei. */
  totalEarned: bigint;
}

function leaderboardAddress(): `0x${string}` {
  return requireAddress(LEADERBOARD_ADDRESS, "VITE_LEADERBOARD_ADDRESS");
}

/** Number of addresses with at least one recorded race. */
export async function fetchPlayerCount(): Promise<number> {
  const count = await readContract(wagmiConfig, {
    address: leaderboardAddress(),
    abi: leaderboardAbi,
    functionName: "playerCount",
  });
  return Number(count);
}

/**
 * One page of players with their stats.
 *
 * The contract returns them in insertion order, not ranked — the set grows
 * without bound, so ranking is the caller's job.
 */
export async function fetchPlayers(offset = 0, limit = 100): Promise<PlayerStats[]> {
  const [addresses, stats] = await readContract(wagmiConfig, {
    address: leaderboardAddress(),
    abi: leaderboardAbi,
    functionName: "getPlayers",
    args: [BigInt(offset), BigInt(limit)],
  });

  return addresses.map((address, i) => ({
    address,
    wins: Number(stats[i].wins),
    races: Number(stats[i].races),
    totalEarned: stats[i].totalEarned,
  }));
}

/**
 * The whole board, ranked: wins first, then earnings, then fewest races — so a
 * player who wins four out of five outranks one who wins four out of forty.
 */
export async function fetchRanking(max = 200): Promise<PlayerStats[]> {
  const total = await fetchPlayerCount();
  if (total === 0) return [];

  const pageSize = 100;
  const pages: PlayerStats[][] = [];
  for (let offset = 0; offset < Math.min(total, max); offset += pageSize) {
    pages.push(await fetchPlayers(offset, pageSize));
  }

  return pages.flat().sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.totalEarned !== a.totalEarned) return b.totalEarned > a.totalEarned ? 1 : -1;
    return a.races - b.races;
  });
}
