# Lessons

Patterns worth not repeating. Each entry is a correction that cost time once.

## A feature that stores its input and never reads it is not a feature

The mint archetype (`sport | muscle | stealth | electric | street`) was a live
contract parameter, a validated `mapping`, an event field and a five-button
selector on two screens. Nothing ever read it back. The car a player received
was decided entirely by the sequential token ID, against a manifest whose
archetypes were a different set of words.

**Rule:** before building or keeping a stored field, name the reader. If the
only consumer is the write itself, delete it — a UI that offers a choice with no
downstream effect is worse than offering nothing.

## Placeholder data outlives the placeholder

`USE_MOCK_FALLBACK` defaulted to *on*, so a wallet owning nothing was shown five
mock cars it did not own, and racing one reverted on-chain. It also hid the
empty state that would have told the player to mint. Meanwhile the onboarding
still announced "5 starter vehicles have been assigned to your garage".

**Rule:** development fallbacks default to off, and the flag lives with an
expiry note. A fallback that fires in the *normal* path (new wallet, no cars) is
not a fallback — it is the product.

## Hardcoded numbers drift away from the constants beside them

`economy.ts` is the single source of truth for prices and splits, and the
waiting room reads it. One screen later the same race showed `ENTRY FEE 1 DRIFT`
and a 500/300/150/50 prize table typed in by hand — the pre-Base numbers.

**Rule:** any figure a contract also knows is computed, never typed. If a screen
shows DRIFT, it calls `calculateRacePayouts`/`formatDrift`.

## `useState(prop)` freezes the prop

`Garage` did `const [cars] = useState(initialCars)`. Minting refreshed the list
in `App`, the new prop arrived, and the garage kept rendering the empty snapshot
it captured at mount — so `OPEN GARAGE` after a successful mint led back to
`GARAGE EMPTY`.

**Rule:** never seed state from a prop that can change. Render the prop; keep
only the selection in state, and reconcile it when the list moves under it.

## Duplicated state machines drift, silently

The mint flow existed twice — `GarageEmptyState` and `WalletHeader` — with two
copies of fee-fetch, balance-check, tx state and error handling. They had
already diverged (only one refreshed the balance afterwards).

**Rule:** the second copy of a state machine is the moment to extract a hook,
not later.

## Credit is not payment

`RaceEscrow` books winnings into `pendingWithdrawals` and leaves the transfer to
`claim()`, because the payout runs inside a VRF callback under a fixed gas
limit. The UI showed `+50 DRIFT` on the results screen and offered no way to
claim it — the money was real and unreachable.

**Rule:** when a contract uses pull payments, the claim path ships in the same
change as the screen that announces the win.

## Verify the whole flow, not the screen you touched

Every problem above survived because each screen was reviewed on its own. They
only read as wrong in sequence: onboarding promises five cars → garage shows
five mock cars → racing one reverts.

**Rule:** for anything touching a player-facing flow, walk it end to end and
check each screen against what the chain actually does at that step.
