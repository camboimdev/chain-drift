# Chain Drift on Base — migration status

New repository. The Klever implementation stays in `chain-drift` and is frozen.

## Done

- [x] Foundry project in `packages/contracts` (OZ v5, Chainlink VRF v2.5, solc 0.8.28)
- [x] `DriftToken` — ERC-20 + ERC20Permit + testnet faucet (replaces KDA `DRIFT-1Q3O`)
- [x] `CarNFT` — ERC-721 Enumerable, DRIFT mint fee, parts loadout (replaces KDA `CAR-2JT4`)
- [x] `RaceEscrow` — async VRF resolution, pull payments, full-pool conservation
- [x] `Leaderboard` — idempotent recording, paginated reads
- [x] Deploy script writing `deployments/<chainId>.json`
- [x] 42 Foundry tests passing against a local VRF mock
- [x] ABI export into `packages/shared/src/abis` (`as const` for viem inference)
- [x] Frontend chain layer on wagmi + viem; `config/klever.ts` and
      `services/kleverWallet.ts` removed
- [x] `WalletContext` rebuilt over wagmi, same `useWallet()` surface
- [x] Leaderboard recorder rewritten in viem
- [x] Metadata pipeline repointed from KDA collection URIs to `setBaseURI`
- [x] README, ARCHITECTURE, CLAUDE.md, `.env.example` files rewritten

## Bugs fixed while porting

- [x] `claimRefund` refunded only the caller, then marked the race Cancelled —
      locking every other entrant out of their own refund. Now `cancelRace`
      credits all entrants once.
- [x] A field of fewer than four left the unclaimed position shares stranded in
      the contract. They now sweep to the fee recipient.
- [x] `enterRace` accepted any `carTokenId`. Ownership is now checked.
- [x] `getAllAddresses()` returned the whole set in one call. Now paginated.
- [x] Open-race discovery cost three RPC calls per candidate ID. Now one
      `getOpenRaces` call on-chain.

## Next

- [ ] Create and fund a Chainlink VRF subscription on Base Sepolia
- [ ] Deploy to Base Sepolia, add `RaceEscrow` as a VRF consumer
- [ ] Fill `packages/frontend/.env.local` with the deployed addresses
- [ ] End-to-end run: faucet → mint → create race → 4 entries → resolve → claim
- [ ] Tune `callbackGasLimit` against a real 4-player resolution
- [ ] Wire a DRIFT faucet button into `GarageEmptyState` for new players
- [ ] Surface `pendingWithdrawals` and a claim button in `WalletHeader`
- [ ] Handle the `isWrongNetwork` state in the UI (`switchToGameChain` is wired
      in the context but no component calls it yet)
- [ ] Re-pin the collection and `setBaseURI` to the IPFS folder
- [ ] Clear the lint debt inherited from the Klever repo (10 errors, all
      pre-existing: `RaceTrack.tsx`, `RaceWaitingRoom.tsx`, `WalletContext.tsx`)

## Notes

- DRIFT moved from 6 to 18 decimals. Anything reasoning in micro-units must use
  `parseEther`/`formatEther`.
- Race IDs and car token IDs are `bigint` in the frontend now, not `number`.
- Race resolution is asynchronous: `requestResolve` returns before the result
  exists. Wait on `RaceFinished` (`waitForRaceFinish`), not on the transaction.
