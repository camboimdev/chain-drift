# Chain Drift — Base Architecture

## Overview

Chain Drift is a browser-based 3D car racing game where cars are ERC-721 NFTs on
**Base**. Players own and race cars using **DRIFT**, an ERC-20 token. ETH pays
gas; every in-game economic action — minting, race entry, prizes — is denominated
in DRIFT.

The 3D race is a **replay**. The contract settles the finishing order from a
Chainlink VRF word before the animation starts; the browser renders a result it
cannot influence.

---

## Chain: Base

| Environment | Chain | ID |
| --- | --- | --- |
| Development | Base Sepolia | 84532 |
| Production | Base | 8453 |

Why Base:

- **Testnet funds are actually obtainable.** The Coinbase Developer Platform
  faucet gives 0.1 ETH per 24 h on a free account, with no mainnet-balance or
  social gate — unlike most L2 faucets.
- **Chainlink VRF v2.5 is deployed** on both Base Sepolia and Base mainnet,
  which the race resolution depends on.
- **Coinbase Smart Wallet** onboards a player with a passkey and no seed phrase,
  which matters more for a racing game than raw throughput. Browser extensions
  are discovered over EIP-6963 and mobile wallets pair over WalletConnect, so
  the connect modal covers every wallet a player is likely to already hold.
- Transaction costs low enough that a per-race escrow is economically sensible.

---

## Contracts

All in `packages/contracts/src`, Solidity 0.8.28 on OpenZeppelin v5.

### DriftToken — ERC-20

| Property | Value |
| --- | --- |
| Name / symbol | Chain Drift / `DRIFT` |
| Decimals | 18 |
| Extensions | `ERC20Permit` (EIP-2612), `Ownable` |

`ERC20Permit` lets `CarNFT.mintWithPermit` and `RaceEscrow.enterRaceWithPermit`
pull the fee from a signature, collapsing approve-then-act into one transaction.

A `faucet()` gives 500 DRIFT per 12 h per address so a new player can mint and
race without any manual distribution — one claim buys a car (100 DRIFT) and
sixteen race entries (25 DRIFT each). **`setFaucetEnabled(false)` before any
mainnet deployment.**

### CarNFT — ERC-721

`ERC721Enumerable`, token IDs from 1 upward. The car is resolved client-side by
token ID against the collection manifest — model, rarity and traits all travel
with the ID — so the contract stores only what the chain must own:

- equipped parts per slot, plus `getEquippedParts(tokenId)` returning the whole
  loadout in one call
- `tokensOfOwner(address)` for the garage

`mint()` takes no arguments: nothing about the car is chosen by the caller, and
the next sequential ID decides which one it is. Minting charges `mintFee` in
DRIFT, forwarded to `feeRecipient`.

### RaceEscrow

```
OPEN ──(room fills)──> LOCKED ──(requestResolve)──> RESOLVING
                                                        │
                                          VRF callback  ▼
                                                      PAID ──> claim()
        └──(1h timeout, cancelRace)──> CANCELLED ──────────────┘
```

Scoring is `score = keccak256(randomWord, carTokenId)`, sorted descending: one
VRF word fans out into a per-car score, so a single request settles the whole
grid.

Prize split, mirroring `shared/src/utils/economy.ts`. Shares are of the **gross**
pool, so the table reads directly against what a player staked:

| Position | Share of pool | Return on a 25 DRIFT entry |
| --- | --- | --- |
| 1st | 50% | 50 DRIFT — double |
| 2nd | 25% | 25 DRIFT — stake back |
| 3rd | 10% | 10 DRIFT |
| 4th | 5% | 5 DRIFT |
| Platform | 10% | 10 DRIFT |

The default entry fee of 25 DRIFT makes a full grid stake exactly 100 DRIFT, so
every prize is a whole number of tokens.

With fewer than four racers the position weights are renormalised over the places
that were filled: the platform still takes exactly 10%, and the missing places'
shares go to the racers who turned up rather than inflating the rake. Only
integer-division dust sweeps to the fee recipient, so nothing is stranded in the
contract.

The frontend never recomputes this split for a settled race. It reads the amounts
out of the `RaceFinished` log, which is what the winner can actually claim.

Three decisions worth knowing:

1. **Chainlink VRF, not a block value.** `block.prevrandao` and `blockhash` are
   the only on-chain alternatives and both are proposer-influenceable, which is
   unacceptable in a contract that pays out. Resolution is asynchronous as a
   consequence: the order is not known until the coordinator calls back.
2. **Pull payments.** The payout runs inside the VRF callback under a fixed
   `callbackGasLimit`. Crediting `pendingWithdrawals` and exposing `claim()`
   keeps the callback cheap and prevents any single recipient from reverting it
   and stranding the randomness.
3. **Car ownership is checked on entry.** `carTokenId` is verified against
   `CarNFT.ownerOf` rather than taken on trust — racing a car you do not own
   would corrupt both the leaderboard and the replay.

### Leaderboard

All-time `wins`, `races` and `totalEarned` per address. `recordResult(raceId, …)`
is idempotent per race ID and callable by the owner, a designated `recorder`, or
`RaceEscrow` itself. `getPlayers(offset, limit)` is paginated: the player set
grows without bound, and returning it whole would eventually run out of gas.

---

## Layers

```
┌───────────────────────────────────────────────────────────────┐
│  FRONTEND (React 19 / react-three-fiber)                      │
│  Web3Provider → WalletProvider → Garage │ Lobby │ RaceScene   │
└───────────────────────┬───────────────────────────────────────┘
                        │  wagmi + viem
┌───────────────────────▼───────────────────────────────────────┐
│  BASE                                                          │
│  DriftToken ─ CarNFT ─ RaceEscrow ─ Leaderboard                │
│                            │                                   │
│                            └── Chainlink VRF v2.5 coordinator  │
└───────────────────────┬───────────────────────────────────────┘
                        │  RaceFinished events
┌───────────────────────▼───────────────────────────────────────┐
│  RECORDER (packages/oracle)   →  Leaderboard.recordResult      │
└───────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│  METADATA API  →  tokenURI JSON, IPFS (Pinata) GLB + PNG       │
└───────────────────────────────────────────────────────────────┘
```

### Why a recorder instead of a direct call

`RaceEscrow` is authorised to call `Leaderboard.recordResult` directly. It does
not, because the payout runs in a VRF callback with a fixed gas limit and those
writes would eat into it. The recorder watches `RaceFinished` and mirrors the
result; `recordResult` being idempotent per race ID makes restarts, retries and
log replays safe. Switching to a direct call later is a one-line change plus a
`callbackGasLimit` bump.

---

## Frontend chain layer

| File | Role |
| --- | --- |
| `config/chain.ts` | Chain selection, RPC, contract addresses from env |
| `config/wagmi.ts` | Connectors and transports |
| `providers/Web3Provider.tsx` | `WagmiProvider` + TanStack Query |
| `context/WalletContext.tsx` | Game-shaped facade over wagmi hooks |
| `services/driftToken.ts` | Balances, allowances, faucet |
| `services/carNft.ts` | Mint, garage reads, parts |
| `services/raceContract.ts` | Race rooms, entry, resolve, claim |
| `services/leaderboard.ts` | All-time standings |
| `hooks/useMintCar.ts` | Mint state machine, shared by both mint surfaces |
| `hooks/useWinnings.ts` | Pending withdrawals and `claim()` |

Everything above this layer — the 3D scene, the garage, the race director — is
chain-agnostic and was carried over unchanged.

`ensureAllowance` only sends an `approve` when the existing allowance is short,
so a returning player pays one transaction per mint or entry, not two.

---

## ABIs

`packages/shared/src/abis/` is generated from the Foundry artifacts by
`packages/contracts/scripts/export-abis.mjs` and exported as `as const` literals.
viem infers argument and return types from them, so the frontend and the recorder
type-check directly against the Solidity source. Re-run `pnpm contracts:build`
after any interface change.

---

## Metadata

`CarNFT.tokenURI` is `<baseURI><tokenId>`, and the base URI points at a pinned
IPFS directory. Nothing in this repository serves metadata at play time — the
collection is published once and the contract points at it.

Republishing is two scripts: `scripts/pin-collection.mjs` pins each car's GLB
and PNG, `scripts/pin-metadata-dir.mjs` uploads the metadata as one directory,
then `setBaseURI("ipfs://<folderCID>/")`. Both read the asset pipeline output,
which lives outside this repository, so neither runs out of a fresh clone. What
was published is recorded in `scripts/collection/`.

The JSON follows the ERC-721 / OpenSea shape: `name`, `description`, `image`,
`animation_url` (the GLB), `external_url`, `attributes`.
