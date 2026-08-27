/**
 * Chain Drift economy — the single source of truth for prices and prize splits.
 *
 * Every number here mirrors an on-chain constant. `calculateRacePayouts`
 * reproduces `RaceEscrow._creditPayouts` exactly, including its integer
 * truncation, so the UI can show a payout before the VRF callback lands and
 * still match the amount the contract credits to the wei.
 *
 * All amounts are in wei: DRIFT has 18 decimals.
 */

/** DRIFT decimals on Base. */
export const DRIFT_DECIMALS = 18;

const ONE_DRIFT = 10n ** BigInt(DRIFT_DECIMALS);

/** Whole DRIFT to wei. */
export function drift(whole: number | bigint): bigint {
  return BigInt(whole) * ONE_DRIFT;
}

// ─── Prices ───────────────────────────────────────────────────────────────

/** Cost of minting one car, in wei. Mirrors `MINT_FEE_DRIFT` at deploy. */
export const CAR_MINT_FEE = drift(100);

/**
 * Default race entry fee, in wei.
 *
 * Chosen so a full four-car grid stakes exactly 100 DRIFT: the split below
 * then pays whole DRIFT at every position instead of trailing decimals.
 */
export const RACE_ENTRY_FEE = drift(25);

// ─── Prize split ──────────────────────────────────────────────────────────

export const BPS_DENOMINATOR = 10_000n;

/** House rake, taken off the top of the pool. Mirrors `PLATFORM_FEE_BPS`. */
export const PLATFORM_FEE_BPS = 1_000n; // 10%

/**
 * Share of the *gross* pool per finishing position, best first.
 *
 * These sum to 9000 — the 1000 left over is the platform fee, which makes the
 * table readable as percentages of what players staked: on a full grid the
 * winner takes 50% (double their entry), 2nd 25% (their entry back), 3rd 10%,
 * 4th 5%.
 *
 * On a short grid the weights are renormalised over the positions that were
 * actually filled, so the house still takes exactly `PLATFORM_FEE_BPS` and the
 * missing places' shares go to the racers who showed up.
 */
export const PAYOUT_BPS: readonly bigint[] = [5_000n, 2_500n, 1_000n, 500n];

/** Largest grid a race room accepts. Mirrors `MAX_PARTICIPANTS`. */
export const MAX_PARTICIPANTS = PAYOUT_BPS.length;

export interface RacePayoutBreakdown {
  /** Total staked by the field. */
  prizePool: bigint;
  /** Credited to the fee recipient — the rake plus any rounding dust. */
  platformFee: bigint;
  /** Credited to each racer, index 0 = winner. */
  payouts: bigint[];
}

/**
 * Split a race pool the way `RaceEscrow` does.
 *
 * @param entryFee  Per-racer stake in wei.
 * @param fieldSize How many racers finished, 1 to `MAX_PARTICIPANTS`.
 */
export function calculateRacePayouts(entryFee: bigint, fieldSize: number): RacePayoutBreakdown {
  const n = Math.max(0, Math.min(fieldSize, MAX_PARTICIPANTS));

  const prizePool = entryFee * BigInt(n);
  const platformFee = (prizePool * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
  const distributable = prizePool - platformFee;

  let totalWeight = 0n;
  for (let i = 0; i < n; i++) totalWeight += PAYOUT_BPS[i];

  const payouts: bigint[] = [];
  let distributed = 0n;
  for (let i = 0; i < n; i++) {
    const amount = totalWeight === 0n ? 0n : (distributable * PAYOUT_BPS[i]) / totalWeight;
    payouts.push(amount);
    distributed += amount;
  }

  // Integer division leaves dust behind; the contract sweeps it with the fee.
  return { prizePool, platformFee: platformFee + (distributable - distributed), payouts };
}

// ─── Formatting ───────────────────────────────────────────────────────────

/**
 * Render a wei amount as DRIFT.
 *
 * Trailing zeros are dropped, so a whole-DRIFT payout reads `50` rather than
 * `50.00`, while dust still shows the digits that distinguish it from zero.
 *
 * @param maxDecimals Digits kept after the point. Default 2.
 */
export function formatDrift(wei: bigint, maxDecimals = 2): string {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;

  const whole = abs / ONE_DRIFT;
  const fraction = abs % ONE_DRIFT;

  let text = whole.toString();

  if (fraction > 0n && maxDecimals > 0) {
    const digits = fraction.toString().padStart(DRIFT_DECIMALS, "0").slice(0, maxDecimals);
    const trimmed = digits.replace(/0+$/, "");
    if (trimmed.length > 0) text += `.${trimmed}`;
  }

  return negative ? `-${text}` : text;
}
