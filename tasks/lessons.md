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

## A constant that is always the same value is a branch that never runs

The track is one straight, so `isAtCorner` returned `false` unconditionally.
That made the corner branch in `calculateSpeedVariation` unreachable, which in
turn meant the `handling` stat — displayed on every car card — affected nothing
at all. Three layers of code kept alive by a stub returning a literal.

**Rule:** when a helper hardcodes its return, follow every caller before leaving
it there. The dead code is rarely the stub itself; it is what the stub gates.

## A service nobody points at is not infrastructure

`packages/metadata-api` served `/metadata/:tokenId` — a whole package, a `.env`,
a README entry and a `dev` script. The deployed contract's base URI had long
since moved to a pinned IPFS directory, so nothing ever called it.

**Rule:** for anything that serves a URL, check what actually points at it —
the contract, the config, the deploy default — not whether the code still runs.

## Two functions with the same name and different behaviour

`driftToken.ts` re-exported `formatEther as formatDrift`. `@chain-drift/shared`
exports its own `formatDrift`, which trims trailing zeros. Neither re-export had
a caller, but either import would have type-checked and rendered differently.

**Rule:** never re-export a general utility under a domain name that already
exists in the codebase. If the domain name is taken, the alias is a trap.

## Rewrite comparisons into reasons

Most references to the previous chain read "the old version did X, so we do Y".
Every one of those decisions stands on its own: VRF because `prevrandao` is
proposer-influenceable, pull payments because the callback has a fixed gas
limit, ownership checks because the leaderboard would be corrupted otherwise.

**Rule:** justify a decision by what it protects against, not by what it
replaced. The comparison rots the moment the reader has no memory of the thing
being compared to — and it drags dead vocabulary along with it.

## Delete or use — a third state is not available

`BLOCK_EXPLORER_URL` sat unused while both mint screens printed a bare 66-
character transaction hash the player would have had to paste into an explorer
by hand. The export was not the problem; the unfinished thought was.

**Rule:** an unused export is a question, not a verdict. Ask what it was for —
sometimes the answer is that the feature is half-built, and finishing it costs
less than the deletion.

## Verify the whole flow, not the screen you touched

Every problem above survived because each screen was reviewed on its own. They
only read as wrong in sequence: onboarding promises five cars → garage shows
five mock cars → racing one reverts.

**Rule:** for anything touching a player-facing flow, walk it end to end and
check each screen against what the chain actually does at that step.
