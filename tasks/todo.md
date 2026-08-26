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

## Base Sepolia playtest (2026-08-25)

Deployed and driven end to end from one wallet with `script/Playtest.s.sol`.

| Contract | Address |
| --- | --- |
| DriftToken | `0x7A0F50a1aB69E633Cc6C9FE46A8a261Dbfa3bb4A` |
| CarNFT | `0xcfB59EC458e9f0B93a18D9c9D34Fc62DC5777F5e` |
| RaceEscrow | `0x3C0d382F26835502a8213164045Be0d882Cf7267` |
| Leaderboard | `0xa49754A5CFC78213b7068Dbba73BEa8d6A2bfD48` |

Worked: deploy (0.0000434 ETH), self-provisioned VRF subscription (owner and
consumer both the escrow), mint, createRace, enterRace, lock on a full grid,
requestResolve.

Stopped at the VRF callback. The DON reserves `callbackGasLimit` at the **gas
lane's max price** — 30 gwei on Base Sepolia's only lane — when deciding whether
a subscription can afford a request. ~0.022 ETH reserved per request against a
0.00003 ETH balance, so the request was accepted on-chain and then sat pending.
Nothing was misconfigured; `pendingRequestExists` was true and the subscription
was billed nothing.

Redeploy once the wallet holds ~0.05 ETH; the deployed contracts predate the two
fixes below.

## Fixed by the playtest

- [x] A race whose VRF callback never arrived was stuck in `Resolving` forever
      and the entry fees were unrecoverable. `cancelRace` now covers `Resolving`
      after `VRF_CALLBACK_TIMEOUT`, measured from the resolve request rather
      than from race creation. A late callback is a no-op, so no double pay.
- [x] `callbackGasLimit` dropped 500k → 300k against a measured ~195k
      four-player fulfilment. The limit is not just a safety bound — it sets the
      balance the DON demands before it will fulfil at all.
- [x] `Deploy.s.sol` recorded the **simulated** VRF subscription ID into
      `deployments/<chainId>.json`. A subscription ID derives from
      `blockhash(block.number - 1)`, so the recorded value never matches the one
      created on-chain. The field is gone; the contract is the source of truth.
- [x] The same derivation broke the deploy outright: `createSubscription()` in
      one recorded transaction and `addConsumer()` in the next reverted with
      `InvalidSubscription()`. `RaceEscrow` now provisions its own subscription
      in its constructor, keeping it to one atomic transaction.

## Next

- [ ] Top the deployer up to ~0.05 ETH and redeploy with the fixes
- [ ] Fund the VRF subscription above the 30 gwei lane reserve (~0.03 ETH)
- [ ] Fill `packages/frontend/.env.local` with the redeployed addresses
- [ ] Finish the end-to-end run through resolve → claim → leaderboard
- [ ] Verify contracts on Basescan (needs `BASESCAN_API_KEY`)
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
