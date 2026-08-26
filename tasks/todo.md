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

## Base Sepolia playtest (2026-08-25) — full loop verified

| Contract | Address |
| --- | --- |
| DriftToken | `0x8a205974fB7CfEE92FCBc6275D79491e79b61210` |
| CarNFT | `0x869E8CacaaB1F0852e1059Abc099290317BE2c20` |
| RaceEscrow | `0x431BA67942ceB3b0b624265C3edA836183fC2Fb0` |
| Leaderboard | `0x54A29Bcc632063a4dFb34f0f23D0d67365067109` |

Two races driven end to end from a single wallet via `script/Playtest.s.sol`
with `maxPlayers = 1`: mint, createRace, enterRace, lock, requestResolve, VRF
callback, claim, leaderboard.

Measured on-chain:

| | |
| --- | --- |
| Deploy (4 contracts + wiring) | 0.0000434 ETH |
| VRF subscription funded | 0.025 ETH |
| VRF billed **per race** | 0.000001755 ETH |
| Time to fulfilment | ~20 s |
| Leaderboard after 2 races | 2 wins, 2 races, 0.95 DRIFT |

The subscription balance is a **reserve, not a spend**: the DON gates on
`callbackGasLimit` priced at the gas lane's 30 gwei max, but bills real gas at
~0.006 gwei. 0.025 ETH covers ~14,000 races of actual billing.

Escrow ends holding exactly the 1 DRIFT staked in a still-open race; every
settled race left it at zero.

An unexplained note, not a known bug: race 2 came out with `maxParticipants = 4`
though every call in this deployment passed 1. It behaved correctly for a
4-player room. Suspected fallout from forge retrying after an EOA nonce
collision, but unproven.

## Fixed by the playtest

- [x] A race whose VRF callback never arrived was stuck in `Resolving` forever
      and the entry fees were unrecoverable. `cancelRace` now covers `Resolving`
      after `VRF_CALLBACK_TIMEOUT`, measured from the resolve request rather
      than from race creation. A late callback is a no-op, so no double pay.
- [x] `callbackGasLimit` dropped 500k → 300k against a measured ~195k
      four-player fulfilment. The limit is not just a safety bound — it sets the
      balance the DON demands before it will fulfil at all.
- [x] The recorder's live watch used `watchContractEvent`, which installs an
      RPC filter and polls it with `eth_getFilterChanges`. Base Sepolia's
      endpoint is load balanced, so the follow-up poll landed on a node that
      never saw the filter: `filter not found`, every tick. It now scans
      explicit block ranges from a tracked cursor, three blocks behind the head.
- [x] `Deploy.s.sol` recorded the **simulated** VRF subscription ID into
      `deployments/<chainId>.json`. A subscription ID derives from
      `blockhash(block.number - 1)`, so the recorded value never matches the one
      created on-chain. The field is gone; the contract is the source of truth.
- [x] The same derivation broke the deploy outright: `createSubscription()` in
      one recorded transaction and `addConsumer()` in the next reverted with
      `InvalidSubscription()`. `RaceEscrow` now provisions its own subscription
      in its constructor, keeping it to one atomic transaction.

## Race bots (2026-08-26) — opponents for live testing

`scripts/race-bots.mts`, wired as `pnpm bots`. Derives three accounts from the
deployer's `MNEMONIC` at fixed indices 100–102, provisions each with gas, DRIFT
and a car, then polls `getOpenRaces` and enters them into any open room. Fixed
indices keep the same drivers and the same cars across runs.

Verified on Base Sepolia across three races (2, 4 and 5):

- Bots filled three of four seats and held the last one until a non-bot address
  entered, then the room locked.
- Locked rooms were resolved by the bots, the classification printed from
  `RaceFinished`, and every bot's `pendingWithdrawals` claimed.
- Killing the script mid-race and restarting it cold picked race 5 back up out
  of `Locked` and carried it through to `Paid`.

Two things the load-balanced RPC forced:

- `send()` holds until `getBlockNumber` reaches the receipt's block. Without it
  `eth_estimateGas` for a mint ran on a node that had not seen the `approve`
  yet, and the run died on `ERC20InsufficientAllowance`.
- The minted token ID comes out of the receipt's `CarMinted` log. Reading
  `tokensOfOwner` back returned an empty array often enough to matter.

## Next

- [ ] Wire the DRIFT faucet button into `GarageEmptyState` for new players
- [ ] Surface `pendingWithdrawals` and a claim button in `WalletHeader`
- [ ] Handle `isWrongNetwork` in the UI (`switchToGameChain` is in the context
      but no component calls it)
- [ ] Load the frontend in a browser against the live deployment — only the
      module graph has been verified, not a real wallet session
- [ ] Verify contracts on Basescan (needs `BASESCAN_API_KEY`)
- [ ] Re-pin the collection and `setBaseURI` to the IPFS folder
- [ ] Clear the lint debt inherited from the Klever repo (10 errors, all
      pre-existing)

## Notes

- DRIFT moved from 6 to 18 decimals. Anything reasoning in micro-units must use
  `parseEther`/`formatEther`.
- Race IDs and car token IDs are `bigint` in the frontend now, not `number`.
- Race resolution is asynchronous: `requestResolve` returns before the result
  exists. Wait on `RaceFinished` (`waitForRaceFinish`), not on the transaction.
- Base Sepolia's public RPC is load balanced. Anything stateful across calls —
  RPC filters especially — breaks on it, and a read straight after a write can
  hit a lagging node.
