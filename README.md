# Chain Drift

On-chain NFT drift racing on **Base**. Players mint car NFTs, stake DRIFT to
enter a race room, and the finishing order is decided on-chain by Chainlink VRF.
The 3D race is a replay of a result the contract already settled.

## Stack

| Layer | Choice |
| --- | --- |
| Chain | Base Sepolia (`84532`) for development, Base (`8453`) for production |
| Contracts | Solidity 0.8.28, Foundry, OpenZeppelin v5 |
| Randomness | Chainlink VRF v2.5 |
| Frontend | React 19, Vite, react-three-fiber, wagmi + viem |
| Wallets | Injected (MetaMask, Rabby…) and Coinbase Smart Wallet (passkey, no seed phrase) |

## Packages

```
packages/
  contracts/     Foundry project — DriftToken, CarNFT, RaceEscrow, Leaderboard
  frontend/      The game: 3D garage, race scene, lobby
  shared/        Types, race logic, generated contract ABIs
  oracle/        Leaderboard recorder — watches RaceFinished, writes stats
```

Token metadata is not served by this repository. The collection is pinned to
IPFS and `CarNFT`'s base URI points at that directory, so `tokenURI` resolves
without anything of ours running. `scripts/collection/` holds the record of what
was pinned, and `scripts/pin-collection.mjs` / `pin-metadata-dir.mjs` are how it
gets republished — both need an asset pipeline that lives outside this
repository, so neither runs out of a fresh clone.

## Contracts

| Contract | Role |
| --- | --- |
| `DriftToken` | ERC-20 DRIFT, the in-game currency. Includes a testnet faucet. |
| `CarNFT` | ERC-721 car collection. Mint costs DRIFT; tracks equipped parts. |
| `RaceEscrow` | Race rooms, entry fees, VRF resolution, prize split. |
| `Leaderboard` | All-time wins, races and earnings per address. |

### Race lifecycle

```
OPEN ──(room fills)──> LOCKED ──(requestResolve)──> RESOLVING
                                                        │
                                          VRF callback  ▼
                                                      PAID ──> claim()
        └──(1h timeout, cancelRace)──> CANCELLED ──────────────┘
```

Resolution is asynchronous. `requestResolve` asks Chainlink VRF for one random
word; the coordinator calls back a few blocks later, and only then does the
contract score the field, sort it, and credit the prize split.

Two deliberate design points:

- **VRF, not a block value.** `block.prevrandao` and `blockhash` are both
  influenceable by the proposer, and this contract pays out real value. There is
  no on-chain source of randomness cheap enough to trust here except an oracle.
- **Pull payments.** The payout runs inside the VRF callback, which has a fixed
  gas limit. Crediting `pendingWithdrawals` and letting winners `claim()` keeps
  the callback cheap and stops any single recipient from making it revert.

## Getting started

### 1. Prerequisites

```bash
# Node + pnpm
pnpm install

# Foundry
curl -L https://foundry.paradigm.xyz | bash && foundryup

# Solidity dependencies (not committed)
pnpm contracts:setup
```

### 2. Get testnet funds

- **Base Sepolia ETH** — the [Coinbase Developer Platform faucet](https://portal.cdp.coinbase.com/products/faucet)
  gives 0.1 ETH per 24 h with a free account, no mainnet balance required.
- **DRIFT** — call `faucet()` on the deployed token: 500 DRIFT per 12 h, no gatekeeping.
  That covers a car (100 DRIFT) and sixteen race entries (25 DRIFT each).

Both the portal and the API pay **0.0001 ETH per claim**, against a cap of 1000
claims per 24 h. Filling a wallet by hand therefore is not practical, so use
`pnpm faucet --target 0.05`: it derives the deployer address from `MNEMONIC`,
works out the shortfall and claims until it is covered. Needs `CDP_API_KEY_ID`
and `CDP_API_KEY_SECRET` from the CDP portal.

No LINK required. `RaceEscrow` requests randomness with `nativePayment` on, so
the VRF subscription is funded in ETH like everything else.

Budget **at least 0.05 ETH**, almost all of it for the VRF subscription.

The deploy itself is cheap — measured at 0.0000434 ETH on Base Sepolia. The
subscription is what costs: the DON decides whether to fulfil a request by
reserving `callbackGasLimit` at the **gas lane's max price**, and Base Sepolia's
only lane is the 30 gwei one, three orders of magnitude above the ~0.006 gwei
actually charged. At the current 300k callback limit that is roughly

    (300_000 + 162_500) x 30 gwei x 1.6 premium  ~=  0.022 ETH

reserved per request. Fund the subscription below that and the request is
accepted on-chain, sits pending forever, and never gets fulfilled. Actual
billing is on real gas used, so a race costs about **0.0000035 ETH** — the
balance is a reserve, not a spend.

### 3. Deploy

```bash
cp packages/contracts/.env.example packages/contracts/.env
# fill in MNEMONIC — a seed phrase created for this project alone
```

Check which address it derives, and fund that one:

```bash
cd packages/contracts
forge script script/ShowDeployer.s.sol --rpc-url base_sepolia
```

Then deploy:

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url base_sepolia --broadcast --verify
```

The script creates the VRF subscription, deploys the four contracts, registers
`RaceEscrow` as a consumer and funds the subscription with `VRF_FUND_WEI` — one
command from nothing to a playable game. Addresses land in
`packages/contracts/deployments/84532.json`.

### 4. Run the game

```bash
node scripts/sync-env.mjs   # copies the deployed addresses into the env files
pnpm dev
```

`sync-env.mjs` reads `packages/contracts/deployments/<chainId>.json` and rewrites
the address lines in `packages/frontend/.env.local` and `packages/oracle/.env`,
creating either from its `.env.example` when missing and leaving every other
setting alone. Run it after every deploy — four addresses across two files is
how a frontend ends up silently pointed at a previous deployment.

### 5. Run the leaderboard recorder (optional)

```bash
cp packages/oracle/.env.example packages/oracle/.env
pnpm --filter @chain-drift/oracle dev
```

The recorder watches `RaceFinished` and writes each classification to the
`Leaderboard` contract. Racing works without it; the game's leaderboard screen
just stays empty, because nothing else writes those stats.

### 6. Put opponents on the grid (optional)

```bash
pnpm bots
```

An empty lobby cannot be tested. `scripts/race-bots.mts` derives three accounts
from the same `MNEMONIC` at fixed indices — 100, 101 and 102 — funds them with
gas and DRIFT, mints each a car, then watches the chain and enters them into any
open race room. Fixed indices mean the same three drivers in the same three cars
on every run, so a lobby is recognisable rather than a fresh set of strangers —
the cars themselves are whatever token IDs the mints happen to hand out.

They leave one seat open until a non-bot address has entered, so the room is
still joinable from the browser, and resolve a full room themselves — printing
the classification and claiming their winnings.

```bash
pnpm bots --status   # roster, balances and cars; no transactions
pnpm bots --setup    # provision the grid, then exit
pnpm bots --fill     # take every seat, for a race with no human in it
pnpm bots --race 7   # only join race 7
```

## Development

```bash
pnpm contracts:build   # forge build + regenerate shared ABIs
pnpm contracts:test    # forge test
pnpm build             # build every package
pnpm lint
```

The contract ABIs in `packages/shared/src/abis/` are generated from the compiled
artifacts by `packages/contracts/scripts/export-abis.mjs`. viem infers argument
and return types from them, so the frontend and the recorder are typed directly
against the Solidity source. Re-run `pnpm contracts:build` after changing a
contract's interface.
