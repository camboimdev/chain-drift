# Chain Drift

On-chain NFT drift racing on **Base**. Players mint car NFTs, stake DRIFT to
enter a race room, and the finishing order is decided on-chain by Chainlink VRF.
The 3D race is a replay of a result the contract already settled.

> This repository is the Base rewrite. The original Klever implementation lives
> in the `chain-drift` repository and is no longer developed.

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
  metadata-api/  ERC-721 metadata JSON + IPFS pinning cache
```

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

- **VRF, not a block value.** The Klever version read `get_block_random_seed()`.
  There is no safe EVM equivalent — `block.prevrandao` and `blockhash` are both
  influenceable by the proposer, and this contract pays out real value.
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
- **DRIFT** — call `faucet()` on the deployed token: 100 DRIFT per 12 h, no gatekeeping.

No LINK required. `RaceEscrow` requests randomness with `nativePayment` on, so
the VRF subscription is funded in ETH like everything else.

Budget roughly **0.05 ETH**: ~6.6M gas for the deploy (about 0.00005 ETH at Base
Sepolia's usual 0.006 gwei) plus whatever you put into the VRF subscription.

### 3. Deploy

```bash
cp packages/contracts/.env.example packages/contracts/.env
# fill in PRIVATE_KEY — use a burner from `cast wallet new`, never a mnemonic

cd packages/contracts
forge script script/Deploy.s.sol:Deploy --rpc-url base_sepolia --broadcast --verify
```

The script creates the VRF subscription, deploys the four contracts, registers
`RaceEscrow` as a consumer and funds the subscription with `VRF_FUND_WEI` — one
command from nothing to a playable game. Addresses land in
`packages/contracts/deployments/84532.json`.

### 4. Run the game

```bash
cp packages/frontend/.env.example packages/frontend/.env.local
# paste the deployed addresses

pnpm dev
```

### 5. Run the leaderboard recorder (optional)

```bash
cp packages/oracle/.env.example packages/oracle/.env
pnpm --filter @chain-drift/oracle dev
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
