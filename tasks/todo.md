# Flow Audit — Strip the First-Version Leftovers

The game moved from "5 starter cars handed to every player" to "mint one car,
join a 4-car on-chain race, get paid by VRF". Several screens still describe the
old game. This pass makes every screen tell the truth about the current one, and
closes the two gaps the audit found.

## Findings

### Onboarding — mostly fiction
- `STARTER FLEET` step promises "5 starter vehicles have been assigned to your
  garage". Nothing assigns cars; a new wallet lands in an empty garage.
- Step 1 reads `BALANCE: … CDT` — a ticker this game does not use. The native
  balance is ETH, the game token is DRIFT.
- `CHOOSE CALLSIGN` collects a username that is stored nowhere and promises a
  leaderboard the frontend does not have.
- `READY` tells the player to "customize parts and configuration" — there is no
  parts UI.

### Mint — the archetype does nothing
- The selector offers `sport | muscle | stealth | electric | street`. The car you
  actually receive is the next sequential `tokenId`, resolved against
  `collectionManifest`, whose archetypes are a different set entirely
  (`Cyber GT`, `Cyber Muscle`, `Drift Coupe`, `Retro Tuner`, `Street Racer`).
- `CarNFT.archetypeOf` is written at mint and never read by anything.
- The whole mint state machine is duplicated between `GarageEmptyState` and
  `WalletHeader`, already drifted apart.

### Garage
- `const [cars] = useState(initialCars)` freezes the list at mount: after a mint,
  `OPEN GARAGE` returns to a garage that is still empty.
- `USE_MOCK_FALLBACK` defaults to on, so a wallet owning nothing is shown mock
  tokens 1–5 — literally the "5 starter cars". Racing one reverts on-chain.
- `carsLoading` renders `LoginPage`, i.e. the login screen to a connected player.
- Dead files: `CarCard.tsx`, `CameraController.tsx` (Garage has its own).

### Race
- After the race is already settled on-chain, `RaceScene` shows a *second* race
  lobby with a randomly generated `RACE_ID`, then a "SCANNING FOR OPPONENTS"
  matchmaking screen. Both are single-player-era leftovers.
- That screen hardcodes `ENTRY FEE 1 DRIFT`, `PRIZE POOL 4 DRIFT` and a
  500/300/150/50 split — the real numbers are 25 / 100 and 50/25/10/5 bps of the
  gross pool (`economy.ts`), and the waiting room one screen earlier shows them.
- `BETTING MODULE — PENDING INTEGRATION` stub with no plan behind it.
- Every car shows identical SPD/ACC/HDL: `calculateCarStats` reads
  `equippedParts`, which `buildCarNFT` always leaves empty.
- `RACE AGAIN` on the finish screen is `onClick={() => {}}`.
- The exhibition/AI path (`aiOpponents`, `selectWinner`, `generateRacePositions`)
  is unreachable — the race view is only ever entered with a settled outcome.

### Gaps with no UI at all
- **Winnings are unclaimable.** `RaceEscrow` credits `pendingWithdrawals` and
  nothing in the app calls `claim()`. `claimWinnings` /
  `getPendingWithdrawals` sit unused in the service.
- **No leaderboard.** The contract and the recorder are live and being written
  to; the frontend never reads them.

## Plan

### 1. Contract — drop the archetype
- [x] `CarNFT.mint()` takes no argument; remove `archetypeOf`,
      `UnknownArchetype`, `_isValidArchetype`; `CarMinted(owner, tokenId)`
- [x] Update `CarNFT.t.sol`, `Playtest.s.sol`, `scripts/race-bots.mts`
- [x] `pnpm contracts:build` to re-export the ABIs, `pnpm contracts:test`

### 2. Mint — one state machine, no archetype
- [x] `useMintCar()` hook owns fee/balance/state/tx; both surfaces render it
- [x] Remove `CarArchetype`, `CAR_ARCHETYPES`, both `ARCHETYPES` tables

### 3. Garage
- [x] Render the `cars` prop instead of freezing it in state
- [x] Delete the mock fallback (`mockCars.ts`, `USE_MOCK_FALLBACK`, env var)
- [x] Loading state inside the garage instead of bouncing to `LoginPage`
- [x] Delete `CarCard.tsx` and `CameraController.tsx`

### 4. Onboarding — two truthful steps
- [x] `WALLET CONNECTED` — address, ETH and DRIFT
- [x] `HOW IT WORKS` — mint → race → claim, with the real numbers
- [x] Drop the callsign and starter-fleet steps

### 5. Race
- [x] `RaceLobby` → `StartingGrid`: real race id, real entry fee, prize table
      from `calculateRacePayouts`, no betting stub
- [x] Matchmaking screen tells the truth (settled race + asset preload);
      `RaceState.MATCHMAKING` → `LOADING`
- [x] Stats derived from archetype + rarity, labelled as cosmetic
- [x] Wire `RACE AGAIN`
- [x] Remove the exhibition path and the race-logic it kept alive

### 6. Claim
- [x] `useWinnings()` — pending balance + `claim()`
- [x] Pending row and CLAIM in the wallet drawer; CLAIM on the finish screen

### 7. Leaderboard
- [x] `services/leaderboard.ts` over `getPlayers` / `getStats`
- [x] `LeaderboardScreen`, reachable from the garage

### 8. Docs
- [x] README / ARCHITECTURE: no archetype, no mock fallback
- [x] Review section here

## Review

Every box above is done. `forge test` is green (53 passed, 0 failed), `tsc -b
--force` is clean across shared and frontend, `vite build` succeeds, and the app
was loaded in a real browser: it boots with no console errors.

### What the contract change costs

`CarNFT.mint()` lost its argument, so **the deployed CarNFT at
`0x7beaa7d4…` is now incompatible with this frontend**. Reads still work — the
bots script listed its roster and their cars against the live chain during
verification — but any mint reverts until the contract is redeployed and
`pnpm sync-env` has rewritten the addresses. `mintWithPermit` lost the same
argument, and `CarMinted` is now `(owner, tokenId)`.

### Extra findings fixed on the way

- The login page's middle feature card sold a "Modular parts system. Infinite
  configurations" that no screen implements. Replaced with what the game does
  do: four-car grids in escrow, and VRF-settled payouts.
- The lobby had no way back to the garage — entering it committed the player to
  creating or joining a race. Added a BACK TO GARAGE button.
- The waiting room's `isMe` compared `p.owner` against a *substring* of the
  connected address (`walletAddress.slice(4, 16)`), so the YOU marker could land
  on the wrong row. Now a plain lowercase address comparison.
- Its `error` state existed but was never set — the setter was named `_setError`
  to silence the unused warning. It now reports a poll failure and a race that
  was cancelled underneath the player.

### Judgement calls worth knowing about

- **Car stats are cosmetic, and now say so.** `calculateCarStats` used to read
  `equippedParts`, which `buildCarNFT` always left empty, so every car on the
  grid showed identical SPD/ACC/HDL. They now come from the car's real manifest
  archetype (`Cyber GT`, `Cyber Muscle`, `Drift Coupe`, `Retro Tuner`,
  `Street Racer`) plus a rarity-based reliability. Nothing about them touches a
  payout — the finish order is VRF's — and the comments in `raceLogic.ts` say
  that outright so the next reader does not mistake it for pay-to-win.
- **The exhibition path is gone, not disabled.** `RaceScene` now requires an
  `outcome`, and `initializeRace` no longer takes one optionally. The race view
  was already unreachable without a settled `RaceFinished`, so the simulated
  outcome, `selectWinner`, `calculateWinProbabilities` and the `weight` field
  were dead weight keeping a whole second code path alive.
- **The parts type scaffolding went with it.** `CarPart`, `PartType`,
  `PartCategory` and `PlayerGarage` modelled a parts system the chain does not
  have — `CarNFT.getEquippedParts` returns free-form `(slot, partId)` strings.
  The contract's parts functions and their service wrappers are untouched; only
  the fictional client-side types are gone.

---

## Pass 2 — final polish

Two follow-up requirements: no trace of the previous chain anywhere, and nothing
left in the repository that no longer serves it.

### Purge the previous chain's vocabulary

Nineteen references across the contracts, the docs and two service comments —
mostly "the old version did X" framing on decisions that stand on their own
merits. Every one rewritten to state the reason directly rather than as a
contrast, and the two ticker/collection identifiers deleted outright. A
case-insensitive search for the old chain's name over the whole repository now
returns nothing outside this file's own history.

- [x] `README.md`, `ARCHITECTURE.md`
- [x] `CarNFT.sol`, `DriftToken.sol`, `RaceEscrow.sol`
- [x] `economy.ts`, `raceContract.ts`

### Deleted — no consumer

- [x] **`packages/metadata-api`**, the whole package. It served
      `/metadata/:tokenId`, but the deployed contract's `TOKEN_BASE_URI` is the
      pinned IPFS directory, so nothing called it. Its `pinata.ts` and
      `ipfs-cache.ts` were already dead — the `POST /pin` route that used them
      is gone. `collection-cache.json` and `metadata-dir.json` moved to
      `scripts/collection/`, next to the scripts that read them.
- [x] **`scripts/pin-all.mjs`** — posted to `POST /pin/:tokenId`, a route that
      no longer exists.
- [x] **The cornering machinery.** The track is one straight, so
      `isAtCorner` returned `false` unconditionally and `getTrackRotation`
      returned `0`. That made `calculateSpeedVariation`'s corner branch
      unreachable and left the `handling` stat with no effect at all.
- [x] **`claimFaucet`, `faucetCooldownRemaining`, `IS_TESTNET`, `resolveIpfs`,
      `ipfsCandidates`** — no callers.
- [x] **`parseDrift` / `formatDrift` re-exported from `driftToken.ts`** — no
      callers, and the name collided with the `formatDrift` in
      `@chain-drift/shared`, which trims differently. A trap waiting for
      whoever imported the wrong one.

### Fixed

- [x] `BLOCK_EXPLORER_URL` was unused while both mint screens printed a bare
      66-character hash. Now a `TxLink` both surfaces share, degrading to plain
      text on a chain with no explorer configured.
- [x] `handling` now drives the lane weave in `calculateLaneDrift`, so the
      archetype profiles are visible on a straight: a Drift Coupe holds its
      line, a Cyber Muscle wanders. Previously the drift amplitude came from a
      hash of the car ID and ignored stats entirely.
- [x] `TOKEN_BASE_URI` defaulted to `http://localhost:3001/metadata/` in both
      `Deploy.s.sol` and `.env.example` — a service that no longer exists. Now
      the published IPFS directory, in both places.
- [x] `Deploy.s.sol` documented `VRF_FUND_WEI` twice, with two different
      defaults. The code says 0.02 ether.
- [x] `claimFaucet`'s doc comment said 100 DRIFT; `FAUCET_AMOUNT` is 500e18.
      Removed with the function.
- [x] **Lint is clean.** Baseline was 9 errors and 2 warnings, all pre-existing.
      `getTrackPosition` moved to `config/trackConfig.ts` next to the geometry
      it derives from, and the wallet context and hook split out of the provider
      into `context/walletContextValue.ts`. Both were Fast Refresh violations —
      editing the provider was invalidating the context identity mid-session.

### Verified

`forge test` 53/53, `tsc -b --force` clean across shared and frontend, oracle
type-checks, `eslint src` reports **0 problems**, `vite build` succeeds, and the
dev server serves every touched module. The workspace is four packages. A sweep
for exports with no consumer across shared, frontend and oracle now comes back
empty.

The browser extension disconnected before a second render check, so the visual
confirmation is the one from pass 1 plus the module-level checks above.

## Kept deliberately

- **The collection publishing scripts** (`pin-collection.mjs`,
  `pin-metadata-dir.mjs`, `render-nft-previews.mjs`). They read an asset
  pipeline that lives outside this repository, so none of them runs out of a
  fresh clone — but they are the only way to re-pin or extend the collection.
  Each now carries a header saying what it needs, and the README says the same.
- **Stuck-race refund.** The waiting room's cancel button never calls
  `cancelRace` — it only navigates back. The button no longer promises a refund
  it does not perform, and the screen now explains that the race becomes
  refundable an hour after it opened, but the call itself is still unwired.
- **The DRIFT faucet has no UI.** `DriftToken.faucet()` pays 500 DRIFT per 12
  hours and nothing in the app calls it, so a fresh wallet on Base Sepolia holds
  0 DRIFT and the mint button reads INSUFFICIENT DRIFT BALANCE with no way
  forward. Deliberate: the faucet is a terminal tool (`cast send $DRIFT
  "faucet()"`), not a product surface. The service wrappers were deleted rather
  than left dangling.
