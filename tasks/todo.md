# Flow Audit — Strip the First-Version Leftovers

The game moved from "5 starter cars handed to every player" to "mint one car,
join a 4-car on-chain race, get paid by VRF". Several screens still describe the
old game. This pass makes every screen tell the truth about the current one, and
closes the two gaps the audit found.

## Findings

### Onboarding — mostly fiction
- `STARTER FLEET` step promises "5 starter vehicles have been assigned to your
  garage". Nothing assigns cars; a new wallet lands in an empty garage.
- Step 1 reads `BALANCE: … CDT` — CDT is the old Klever ticker. The native
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

## Not in this pass
- **Stuck-race refund.** The waiting room's `CANCEL (REFUND AFTER 1H TIMEOUT)`
  never calls `cancelRace` — it only navigates back. Its `error` state is never
  set, and `isMe` compares a substring of the address instead of the address.
  The button text is being corrected so it stops promising a refund it does not
  perform; wiring the real refund is deferred.
