# Race Visual Polish — Agent Distribution

Goal: make the race event presentable. Five agents, disjoint file ownership.

## Shared contracts (all agents must honour)

- **Ground plane:** the drivable track surface top is exactly `y = 0`.
  Floor decals sit at `y <= 0.02`. A car's wheel contact point sits at `y = 0`.
- **Brand:** `.claude/skills/chain-drift-design/SKILL.md` — monochrome base,
  at most ONE accent (`#00D1FF`). No cyan+magenta Tron mix.
- **Car3D API:** `interactive?: boolean` (default `false`) gates hover-scale and
  the idle showroom wobble. Garage/CarPreview pass it; the race never does.
- **Preloader API:** `src/services/carModelPreloader.ts` exports
  `loadCarModel(url)` and
  `preloadCarModels(tokenIds, onProgress?) => Promise<void>`.
- **Exhaust API:** `src/components/effects/CarExhaust.tsx` exports
  `CarExhaustHandle { setState(speedFactor, boosting, boostIntensity) }` and
  `CarExhaust = forwardRef<CarExhaustHandle, { offset?: [number,number,number] }>`.
- **Stable exports:** `RaceTrack.tsx` keeps exporting `RaceTrack`,
  `getTrackPosition`, `getTrackRotation`, `isAtCorner` and the `trackConfig`
  re-exports.

## Agent A — Asset preload gate
Owns: `Car3D.tsx`, `services/carModelPreloader.ts` (new), `RaceScene.tsx`
- [ ] Move the model cache out of Car3D into the preloader service
- [ ] Real progress-driven loading screen; race cannot start until every
      participant model is parsed
- [ ] Add `interactive` prop; stop the showroom wobble leaking into the race
- [ ] Scene atmosphere: drop the chromatic aberration, retune fog/bloom

## Agent B — Track surface
Owns: `RaceTrack.tsx`, `config/trackConfig.ts`
- [ ] Replace the Tron grid with asphalt (procedural canvas + normal map)
- [ ] Lane markings, edge lines, kerbs, barriers, racing line, start grid boxes
- [ ] Surface top exactly at y=0, no z-fighting

## Agent C — Car grounding & vehicle feel
Owns: `RaceDirector.tsx`
- [ ] Remove the 0.5 float; wheels on the ground
- [ ] Contact shadow, weight transfer (squat/dive), roll on lateral load
- [ ] Wire in `CarExhaust`, delete the cone meshes
- [ ] Fix the shadow-casting light to track the cars

## Agent D — Camera
Owns: `RaceCamera.tsx`
- [ ] Framerate-independent damping; kill the stacked sinusoids
- [ ] Broadcast grammar: hold a shot, then cut — never swoop continuously
- [ ] Shake tied to speed, not to `Math.random()` every frame

## Agent E — Thruster / exhaust
Owns: `components/effects/CarExhaust.tsx` (new)
- [ ] Layered additive plume, heat haze, flicker; afterburner on boost

## Review

All five workstreams landed. `tsc -b` and `vite build` both clean; the six lint
errors in RaceTrack.tsx are pre-existing (main had seven).

**Verified in a real browser** (headless SwiftShader cannot create a WebGL2
context, so verification ran headful against the GPU through puppeteer, driving
a throwaway preview harness that mounted RaceScene with mock cars — harness
since removed).

Fixed during integration, on top of the agents' work:
- Tyre dust rendered as glowing white spheres: `size: 0.85` on a 6 m car plus an
  opaque-cored texture under additive blending. Now a 0.4 gaussian puff that
  reads as smoke.
- The barrier accent strip runs the full circuit and passes within metres of the
  low camera rigs; at `emissiveIntensity 2.4` with `toneMapped={false}` it
  bloomed into a neon bar that owned the frame — the exact Tron look the
  one-accent policy exists to prevent. Now 0.55 and tone mapped.
- **The asset gate had no ceiling.** Waiting on the models is correct, but on a
  degraded IPFS day (four gateways timing out in sequence) the player sat on
  `STREAMING CAR ASSETS [0/4]` for minutes — trading "starts too early" for
  "may never start". Added `ASSET_DEADLINE_MS = 20000`: the race starts on the
  models or the deadline, whichever comes first.

Open, not addressed:
- The race clock read a ~15 minute offset in one sample while ticking at the
  correct rate; the fresh sample from the same run read correctly. Most likely
  cross-talk between two overlapping capture runs writing to one directory, but
  unconfirmed. The countdown effect (`RaceDirector.tsx:908`) is pre-existing and
  untouched by this work — it stacks an uncancelled `setTimeout` on re-render,
  which is worth a look regardless.
- IPFS gateway reliability: `dweb.link`/`w3s.link`/`ipfs.io` intermittently
  refuse CORS from localhost and Pinata 404s some CIDs. Pre-existing, and the
  reason the deadline above matters.

---

# DRIFT Economy — Exact Payouts and Coherent Pricing

Reported: the DRIFT figures on the results screen are wrong (+500/+300/+150/+50
on a race whose real pool was 4 DRIFT). Two separate faults, plus a pricing pass.

## Plan

- [x] Trace where the results screen gets its numbers
- [x] One source of truth for prices and the split, mirroring the contract
- [x] Contract: rake and split to the chosen structure, fair on short fields
- [x] Feed the results screen the escrow's own numbers, not a local estimate
- [x] Price mint / entry / faucet coherently
- [x] `pnpm contracts:test`, frontend typecheck, frontend build
- [x] Docs

## What was actually wrong

1. **The numbers were never on-chain.** `raceStore.ts` hardcoded
   `prizePool: 1000` and `RaceDirector.tsx` split *that* by 50/30/15/5. The
   escrow's `RaceFinished` event — which carries the exact finish order and the
   exact payouts — was read by nothing. `waitForRaceFinish` existed and was
   never called; the waiting room polled `getRaceStatus` and threw the result
   away.
2. **The animation disagreed with the chain.** `App.tsx` passed
   `getParticipants` (entry order) and claimed in a comment it was VRF finish
   order, while `initializeRace` rolled its own winner with `selectWinner`. The
   car the player watched win was not the car the contract paid.
3. **Six-decimal formatter on an 18-decimal token.** `RaceWaitingRoom.tsx`
   divided by `1e6` — a leftover from the Klever KDA. Every DRIFT figure in the
   waiting room was off by 10^12.

## Changes

**`shared/src/utils/economy.ts` (new)** — prices, split constants,
`calculateRacePayouts`, `formatDrift`. Reproduces `_creditPayouts` including its
integer truncation, so a pre-race estimate matches the credited amount to the wei.

**`RaceEscrow.sol`** — rake 5% → 10%; position shares restated against the gross
pool (50/25/10/5, summing to 9000 bps with the rake as the residual 1000). Short
fields renormalise the weights over the places actually filled: previously the
3rd and 4th shares of a two-car race swept to the fee recipient, quietly turning
a 5% rake into 25%. Only dust sweeps now.

**Frontend** — `getRaceFinish` reads the `RaceFinished` log (bounded 500-block
lookback; the public RPC caps `eth_getLogs` spans). The waiting room hands the
settled result up; `App` builds the grid from it; the store takes it as the
authoritative finish order and payout table; `RaceUI` formats wei.
`RaceResult.payouts[].amount` and `RaceConfig.entryFee` are `bigint` wei now —
a `number` of DRIFT cannot represent a payout exactly.

**Prices** — mint 1 → 100 DRIFT, entry 1 → 25 DRIFT, faucet 100 → 500 DRIFT.
Entry 25 makes a full grid stake exactly 100 DRIFT, so every prize is a whole
number: 50 / 25 / 10 / 5, house 10. Winner doubles, 2nd breaks even. One faucet
claim buys a car and sixteen entries.

## Review

- `pnpm contracts:test`: 54 passed. Two new tests — a full grid pays whole
  multiples of the entry (2×/1×/0.4×/0.2×), and a short field keeps the rake at
  exactly 10% instead of inflating it.
- Value conservation verified for fields of 1–4 and for an indivisible entry fee
  (`333333333333333333` wei): payouts + fee == pool in every case.
- Frontend typecheck and `vite build` clean.
- `forge fmt` still reports the six files it reported before this change; no new
  violations.

## Open

- The exhibition run (no on-chain race, AI opponents) shows the payouts a real
  race of that size would carry, but pays nothing. It is a demo path — worth a
  visual marker on the results screen so the figures cannot be mistaken for
  winnings.
- The contract is not redeployed. The new rake, split and mint fee only take
  effect after `pnpm contracts:deploy`; the entry fee is per-race and applies to
  rooms created after the frontend ships.
