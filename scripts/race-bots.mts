#!/usr/bin/env node
/**
 * Race bots — Chain Drift
 *
 * Gives a locally running lobby opponents to race against. Derives a fixed set
 * of accounts from the same `MNEMONIC` the deployer uses, provisions each one
 * with gas, DRIFT and a car, then watches the chain and enters them into any
 * open race room.
 *
 * The derivation indices are fixed, so the bots are the *same* three players
 * with the *same* three cars on every run — a reusable grid rather than a fresh
 * set of strangers each time you reload the app.
 *
 * Usage:
 *   pnpm bots                       # provision, then watch and join open races
 *   pnpm bots --setup               # provision only, then exit
 *   pnpm bots --status              # print the roster and balances, no writes
 *   pnpm bots --race 7              # only join race 7
 *   pnpm bots --fill                # take every free seat, including the last
 *   pnpm bots --bots 2              # put fewer cars on the grid
 *
 * By default the bots leave one seat open until a non-bot address has entered,
 * so the room is still joinable from the browser. `--fill` drops that rule for
 * a bot-only race.
 *
 * A locked room is resolved automatically: the bots call `requestResolve`, wait
 * for the VRF callback, print the classification and claim their winnings. The
 * waiting room in the browser races them to it and one of the two calls
 * reverts — that is expected and ignored.
 *
 * Env (packages/contracts/.env is loaded automatically):
 *   MNEMONIC                  seed the bots and the deployer derive from
 *   MNEMONIC_INDEX            deployer account index (default 0)
 *   BOT_INDEX_START           first bot account index (default 100)
 *   BASE_SEPOLIA_RPC_URL      RPC endpoint
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { carNftAbi, driftTokenAbi, raceEscrowAbi } from "@chain-drift/shared";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  maxUint256,
  parseEther,
  parseEventLogs,
  type Address,
  type Chain,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { mnemonicToAccount, type HDAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ─── Bot roster ─────────────────────────────────────────────────────────────

/**
 * Slot definitions. A bot's identity is its offset from `BOT_INDEX_START`, so
 * slot 0 is always Nitro — recognisable across runs and across redeploys of
 * the contracts. The car itself is whatever the next token ID happens to be.
 */
const ROSTER = [
  { name: "Nitro" },
  { name: "Vortex" },
  { name: "Ghost" },
  { name: "Blaze" },
] as const;

/**
 * Gas floor per bot, and the amount topped up to when it is breached.
 *
 * A Base Sepolia transaction costs a few hundred gwei, so 0.0002 ETH is
 * hundreds of races — kept deliberately small because the deployer's own
 * balance comes from a faucet that pays 0.0001 ETH per claim.
 */
const MIN_GAS_WEI = parseEther("0.00005");
const TOPUP_GAS_WEI = parseEther("0.0002");

/** DRIFT floor per bot, over and above whatever a car costs to mint. */
const MIN_DRIFT_WEI = parseEther("500");

/** How many recent race IDs to check for unfinished business at start-up. */
const ADOPT_SCAN = 20n;

/** How long to wait on a VRF callback before giving up on printing the result. */
const RESOLVE_TIMEOUT_MS = 5 * 60_000;

const RACE_STATUS = ["None", "Open", "Locked", "Resolving", "Paid", "Cancelled"] as const;

// ─── .env loading ───────────────────────────────────────────────────────────

/**
 * Minimal .env reader.
 *
 * Deliberately not a dependency: this file handles a seed phrase, and the fewer
 * third-party packages that touch it the better.
 */
function loadEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv(resolve(repoRoot, "packages/contracts/.env"));
loadEnv(resolve(repoRoot, ".env"));

// ─── Args ───────────────────────────────────────────────────────────────────

interface Args {
  bots: number;
  chainId: number;
  fill: boolean;
  help: boolean;
  indexStart: number;
  interval: number;
  raceId: bigint | null;
  resolve: boolean;
  setup: boolean;
  status: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    bots: 3,
    chainId: 84532,
    fill: false,
    help: false,
    indexStart: Number(process.env.BOT_INDEX_START ?? 100),
    interval: 4000,
    raceId: null,
    resolve: true,
    setup: false,
    status: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case "--bots":
        args.bots = Number(next());
        break;
      case "--chain-id":
        args.chainId = Number(next());
        break;
      case "--fill":
        args.fill = true;
        break;
      case "--index-start":
        args.indexStart = Number(next());
        break;
      case "--interval":
        args.interval = Number(next());
        break;
      case "--race":
        args.raceId = BigInt(next());
        break;
      case "--no-resolve":
        args.resolve = false;
        break;
      case "--setup":
        args.setup = true;
        break;
      case "--status":
        args.status = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        fail(`Unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
  process.exit(0);
}

if (!Number.isInteger(args.bots) || args.bots < 1 || args.bots > ROSTER.length) {
  fail(`--bots must be between 1 and ${ROSTER.length}`);
}

// ─── Chain and contracts ────────────────────────────────────────────────────

const CHAINS: Record<number, Chain> = { 84532: baseSepolia, 8453: base };

const chain = CHAINS[args.chainId];
if (!chain) fail(`Unsupported --chain-id ${args.chainId}`);

const deploymentPath = resolve(repoRoot, `packages/contracts/deployments/${args.chainId}.json`);
if (!existsSync(deploymentPath)) {
  fail(`No deployment for chain ${args.chainId} at ${deploymentPath}\nRun the deploy script first.`);
}
const deployment = JSON.parse(readFileSync(deploymentPath, "utf8")) as {
  driftToken: Address;
  carNft: Address;
  raceEscrow: Address;
};

const mnemonic = process.env.MNEMONIC;
if (!mnemonic) {
  fail("MNEMONIC is not set. Add it to packages/contracts/.env.");
}

const rpcUrl =
  (args.chainId === 8453 ? process.env.BASE_RPC_URL : process.env.BASE_SEPOLIA_RPC_URL) ??
  process.env.RPC_URL ??
  chain.rpcUrls.default.http[0];

const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ chain, transport: http(rpcUrl) });

// Same BIP-44 path Foundry's `deriveKey` and the recorder use, so index 0 is
// the deployer — the account that owns DriftToken and holds the faucet ETH.
const deployer = mnemonicToAccount(mnemonic, {
  addressIndex: Number(process.env.MNEMONIC_INDEX ?? 0),
});

interface Bot {
  account: HDAccount;
  address: Address;
  index: number;
  name: string;
  /** Filled in by `provision`; the car this bot races. */
  carTokenId?: bigint;
}

const bots: Bot[] = ROSTER.slice(0, args.bots).map((slot, i) => {
  const index = args.indexStart + i;
  const account = mnemonicToAccount(mnemonic, { addressIndex: index });
  return {
    account,
    address: account.address,
    index,
    name: slot.name,
  };
});

const botAddresses = new Set(bots.map((b) => b.address.toLowerCase()));
const isBot = (address: Address) => botAddresses.has(address.toLowerCase());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const short = (address: Address) => `${address.slice(0, 6)}…${address.slice(-4)}`;

const drift = (wei: bigint) => `${Number(formatEther(wei)).toFixed(2)} DRIFT`;

/** viem wraps revert reasons; the short message is the only useful part here. */
function reason(err: unknown): string {
  if (err && typeof err === "object" && "shortMessage" in err) {
    return String((err as { shortMessage: unknown }).shortMessage);
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Wait for a transaction, then hold until the RPC's own head has reached the
 * block that mined it.
 *
 * Base Sepolia's public endpoint is a pool of nodes: one of them confirms the
 * receipt while the next `eth_call` or `eth_estimateGas` is answered by another
 * that is still a block or two behind. Without this barrier a mint is estimated
 * against a state where the `approve` it depends on has not happened yet, and
 * the whole run dies on `ERC20InsufficientAllowance`.
 */
async function send(hash: Hex): Promise<TransactionReceipt> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  for (let i = 0; i < 40; i++) {
    // `cacheTime: 0` because viem otherwise reuses a block number it read
    // before the transaction landed, which is exactly the value being waited on.
    const head = await publicClient.getBlockNumber({ cacheTime: 0 });
    if (head >= receipt.blockNumber) break;
    await sleep(500);
  }

  return receipt;
}

// ─── Reads ──────────────────────────────────────────────────────────────────

const readDrift = (address: Address) =>
  publicClient.readContract({
    address: deployment.driftToken,
    abi: driftTokenAbi,
    functionName: "balanceOf",
    args: [address],
  });

const readCars = (address: Address) =>
  publicClient.readContract({
    address: deployment.carNft,
    abi: carNftAbi,
    functionName: "tokensOfOwner",
    args: [address],
  });

const readRace = (raceId: bigint) =>
  publicClient.readContract({
    address: deployment.raceEscrow,
    abi: raceEscrowAbi,
    functionName: "getRace",
    args: [raceId],
  });

const readStatus = async (raceId: bigint) =>
  RACE_STATUS[
    await publicClient.readContract({
      address: deployment.raceEscrow,
      abi: raceEscrowAbi,
      functionName: "getRaceStatus",
      args: [raceId],
    })
  ];

const readParticipants = (raceId: bigint) =>
  publicClient.readContract({
    address: deployment.raceEscrow,
    abi: raceEscrowAbi,
    functionName: "getParticipants",
    args: [raceId],
  });

// ─── Provisioning ───────────────────────────────────────────────────────────

/**
 * Bring a bot's DRIFT balance up to `target`, and report whether it moved.
 *
 * Called both at start-up and before an entry: a bot pays an entry fee every
 * race and only gets part of it back, so a long session would otherwise grind
 * the grid down to bots that cannot afford to line up.
 */
async function fundDrift(bot: Bot, target: bigint): Promise<void> {
  const balance = await readDrift(bot.address);
  if (balance >= target) return;

  const amount = target - balance;

  // The deployer owns the token in every deployment this script targets, so
  // minting is one transaction with no cooldown. The public faucet is the
  // fallback for a deployment whose ownership has moved on — it pays a fixed
  // 100 DRIFT once every 12 hours, so it may not reach the target in one go.
  if (driftOwner.toLowerCase() === deployer.address.toLowerCase()) {
    await send(
      await walletClient.writeContract({
        account: deployer,
        chain,
        address: deployment.driftToken,
        abi: driftTokenAbi,
        functionName: "mint",
        args: [bot.address, amount],
      })
    );
  } else {
    await send(
      await walletClient.writeContract({
        account: bot.account,
        chain,
        address: deployment.driftToken,
        abi: driftTokenAbi,
        functionName: "faucet",
      })
    );
  }

  console.log(`${bot.name.padEnd(6)} ${short(bot.address)}  funded ${drift(amount)}`);
}

/**
 * Bring one bot to a state where it can enter a race: gas, DRIFT, a car, and a
 * standing DRIFT allowance for the escrow.
 *
 * Every step is a no-op when the bot already satisfies it, so this is safe to
 * run on every start — and after a redeploy it simply re-mints the cars the new
 * `CarNFT` does not know about yet.
 */
async function provision(bot: Bot, mintFee: bigint): Promise<void> {
  const label = `${bot.name.padEnd(6)} ${short(bot.address)}`;

  // ── Gas ──
  const ethBalance = await publicClient.getBalance({ address: bot.address });
  if (ethBalance < MIN_GAS_WEI) {
    const amount = TOPUP_GAS_WEI - ethBalance;
    const deployerBalance = await publicClient.getBalance({ address: deployer.address });
    if (deployerBalance < amount) {
      fail(
        `${label}: needs ${formatEther(amount)} ETH for gas but the deployer only holds ` +
          `${formatEther(deployerBalance)} ETH.\nTop it up with \`pnpm faucet\` and run again.`
      );
    }
    await send(
      await walletClient.sendTransaction({
        account: deployer,
        chain,
        to: bot.address,
        value: amount,
      })
    );
    console.log(`${label}  funded ${formatEther(amount)} ETH`);
  }

  // ── DRIFT ──
  const cars = await readCars(bot.address);
  const needsCar = cars.length === 0;
  await fundDrift(bot, MIN_DRIFT_WEI + (needsCar ? mintFee : 0n));

  // ── Car ──
  if (needsCar) {
    if (mintFee > 0n) {
      await send(
        await walletClient.writeContract({
          account: bot.account,
          chain,
          address: deployment.driftToken,
          abi: driftTokenAbi,
          functionName: "approve",
          args: [deployment.carNft, mintFee],
        })
      );
    }
    const receipt = await send(
      await walletClient.writeContract({
        account: bot.account,
        chain,
        address: deployment.carNft,
        abi: carNftAbi,
        functionName: "mint",
      })
    );
    // The token ID comes out of the receipt's own `CarMinted` log — reading the
    // garage back would be a second round trip against a possibly stale node.
    const [minted] = parseEventLogs({
      abi: carNftAbi,
      eventName: "CarMinted",
      logs: receipt.logs,
    });
    bot.carTokenId = minted?.args.tokenId;
    console.log(`${label}  minted car #${bot.carTokenId}`);
  } else {
    bot.carTokenId = cars[0];
  }

  // ── Standing allowance for the escrow ──
  const allowance = await publicClient.readContract({
    address: deployment.driftToken,
    abi: driftTokenAbi,
    functionName: "allowance",
    args: [bot.address, deployment.raceEscrow],
  });
  // An infinite allowance keeps every later entry to a single transaction; these
  // are throwaway testnet accounts, so there is nothing to protect by scoping it.
  if (allowance < MIN_DRIFT_WEI) {
    await send(
      await walletClient.writeContract({
        account: bot.account,
        chain,
        address: deployment.driftToken,
        abi: driftTokenAbi,
        functionName: "approve",
        args: [deployment.raceEscrow, maxUint256],
      })
    );
    console.log(`${label}  approved the escrow`);
  }
}

/** Withdraw whatever the escrow owes a bot, so its DRIFT keeps circulating. */
async function claimWinnings(bot: Bot): Promise<void> {
  const pending = await publicClient.readContract({
    address: deployment.raceEscrow,
    abi: raceEscrowAbi,
    functionName: "pendingWithdrawals",
    args: [bot.address],
  });
  if (pending === 0n) return;

  await send(
    await walletClient.writeContract({
      account: bot.account,
      chain,
      address: deployment.raceEscrow,
      abi: raceEscrowAbi,
      functionName: "claim",
    })
  );
  console.log(`${bot.name} claimed ${drift(pending)}`);
}

// ─── Status ─────────────────────────────────────────────────────────────────

async function printRoster(): Promise<void> {
  for (const bot of bots) {
    const [eth, driftBalance, cars] = await Promise.all([
      publicClient.getBalance({ address: bot.address }),
      readDrift(bot.address),
      readCars(bot.address),
    ]);
    const car = cars.length > 0 ? `car #${cars[0]}` : "no car";
    console.log(
      `  ${bot.name.padEnd(6)} m/44'/60'/0'/0/${String(bot.index).padEnd(4)} ${bot.address}  ` +
        `${Number(formatEther(eth)).toFixed(4)} ETH  ${drift(driftBalance)}  ${car}`
    );
  }
}

// ─── Race watching ──────────────────────────────────────────────────────────

interface Tracked {
  resolveSentAt: number | null;
  /** Block the resolve request landed in, so `RaceFinished` can be found again. */
  fromBlock: bigint | null;
}

const tracked = new Map<bigint, Tracked>();

/** Enter as many bots as the room allows, leaving a seat for a human by default. */
async function joinRace(raceId: bigint): Promise<void> {
  const race = await readRace(raceId);
  const participants = await readParticipants(raceId);

  const taken = participants.length;
  const humanPresent = participants.some((p) => !isBot(p.player));
  const alreadyIn = new Set(
    participants.filter((p) => isBot(p.player)).map((p) => p.player.toLowerCase())
  );

  // Hold the last seat open until a human takes it, or the room would lock
  // before the browser ever gets a chance to enter.
  const reserved = args.fill || humanPresent ? 0 : 1;
  let seats = race.maxParticipants - taken - reserved;
  if (seats <= 0) return;

  for (const bot of bots) {
    if (seats <= 0) break;
    if (alreadyIn.has(bot.address.toLowerCase())) continue;
    if (bot.carTokenId === undefined) continue;

    // Five races' worth, so the grid is not topped up one entry at a time.
    await fundDrift(bot, race.entryFee * 5n);

    try {
      await send(
        await walletClient.writeContract({
          account: bot.account,
          chain,
          address: deployment.raceEscrow,
          abi: raceEscrowAbi,
          functionName: "enterRace",
          args: [raceId, bot.carTokenId],
        })
      );
      console.log(
        `race ${raceId}: ${bot.name} entered with car #${bot.carTokenId} ` +
          `(${drift(race.entryFee)})`
      );
      seats--;
      tracked.set(raceId, tracked.get(raceId) ?? { resolveSentAt: null, fromBlock: null });
    } catch (err) {
      // A human filling the room mid-loop is the normal way this fails.
      console.log(`race ${raceId}: ${bot.name} could not enter — ${reason(err)}`);
      return;
    }
  }
}

/** Ask VRF to settle a locked room the bots are in. */
async function resolveRace(raceId: bigint, state: Tracked): Promise<void> {
  try {
    const hash = await walletClient.writeContract({
      account: bots[0].account,
      chain,
      address: deployment.raceEscrow,
      abi: raceEscrowAbi,
      functionName: "requestResolve",
      args: [raceId],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    state.fromBlock = receipt.blockNumber;
    state.resolveSentAt = Date.now();
    console.log(`race ${raceId}: resolve requested, waiting for the VRF callback…`);
  } catch (err) {
    // The browser's waiting room resolves too and one of the two always loses
    // the race to `RaceNotLocked`. Either way the request is in flight — record
    // the current head so the `RaceFinished` lookup still has a floor to scan
    // from rather than falling back to the whole chain.
    state.fromBlock = await publicClient.getBlockNumber({ cacheTime: 0 });
    state.resolveSentAt = Date.now();
    console.log(`race ${raceId}: resolve already requested (${reason(err)})`);
  }
}

/** Print the final classification and let the bots collect. */
async function reportFinish(raceId: bigint, state: Tracked): Promise<void> {
  const logs = await publicClient.getContractEvents({
    address: deployment.raceEscrow,
    abi: raceEscrowAbi,
    eventName: "RaceFinished",
    args: { raceId },
    fromBlock: state.fromBlock ?? "earliest",
  });

  const result = logs[logs.length - 1]?.args;
  if (result?.players && result.carTokenIds && result.payouts) {
    console.log(`race ${raceId}: finished`);
    result.players.forEach((player, i) => {
      const name = bots.find((b) => b.address.toLowerCase() === player.toLowerCase())?.name ?? "YOU";
      console.log(
        `  ${i + 1}. ${name.padEnd(6)} car #${String(result.carTokenIds![i]).padEnd(4)} ` +
          `${drift(result.payouts![i] ?? 0n)}`
      );
    });
  } else {
    console.log(`race ${raceId}: finished (no RaceFinished log found from block ${state.fromBlock})`);
  }

  for (const bot of bots) await claimWinnings(bot);
}

/**
 * Pick up rooms a previous run left mid-flight.
 *
 * `getOpenRaces` only reports rooms still taking players, so without this a
 * Ctrl-C during a locked race leaves the bots' entry fees waiting on a browser
 * tab that may already be closed.
 */
async function adoptPendingRaces(): Promise<void> {
  const nextId = await publicClient.readContract({
    address: deployment.raceEscrow,
    abi: raceEscrowAbi,
    functionName: "nextRaceId",
  });

  const oldest = nextId > ADOPT_SCAN ? nextId - ADOPT_SCAN : 1n;
  for (let raceId = nextId - 1n; raceId >= oldest; raceId--) {
    const status = await readStatus(raceId);
    if (status !== "Locked" && status !== "Resolving") continue;

    const participants = await readParticipants(raceId);
    if (!participants.some((p) => isBot(p.player))) continue;

    // `resolveSentAt: null` because a request already in flight is
    // indistinguishable from one that was never sent. A room still Locked gets
    // the request re-sent, which reverts harmlessly if it was not needed; one
    // already Resolving simply waits for the callback.
    tracked.set(raceId, { resolveSentAt: null, fromBlock: null });
    console.log(`race ${raceId}: picked up, still ${status.toLowerCase()}`);
  }
}

async function tick(): Promise<void> {
  const open = args.raceId
    ? [args.raceId]
    : await publicClient.readContract({
        address: deployment.raceEscrow,
        abi: raceEscrowAbi,
        functionName: "getOpenRaces",
        args: [10n, 40n],
      });

  // Rooms the bots are already in stay on the list past Open, so the loop can
  // carry them through resolution.
  const ids = [...new Set([...open, ...tracked.keys()])];

  for (const raceId of ids) {
    const status = await readStatus(raceId);

    const state = tracked.get(raceId);

    switch (status) {
      case "Open":
        await joinRace(raceId);
        break;

      case "Locked": {
        // A restart loses the tracking map, so re-adopt any locked room the
        // bots are sitting in — otherwise their entry fees wait for a browser
        // that may never open.
        let locked = state;
        if (!locked) {
          const participants = await readParticipants(raceId);
          if (!participants.some((p) => isBot(p.player))) break;
          locked = { resolveSentAt: null, fromBlock: null };
          tracked.set(raceId, locked);
        }
        if (args.resolve && locked.resolveSentAt === null) {
          await resolveRace(raceId, locked);
        }
        break;
      }

      case "Resolving":
        if (state?.resolveSentAt && Date.now() - state.resolveSentAt > RESOLVE_TIMEOUT_MS) {
          console.log(
            `race ${raceId}: no VRF callback after ${RESOLVE_TIMEOUT_MS / 60_000} min — ` +
              `check the subscription balance with \`vrfNativeBalance\``
          );
          tracked.delete(raceId);
        }
        break;

      case "Paid":
        if (state) {
          tracked.delete(raceId);
          await reportFinish(raceId, state);
        }
        break;

      case "Cancelled":
        if (state) {
          tracked.delete(raceId);
          console.log(`race ${raceId}: cancelled`);
          for (const bot of bots) await claimWinnings(bot);
        }
        break;
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

console.log("─── Chain Drift race bots ───");
console.log(`chain    ${chain.name} (${chain.id})`);
console.log(`escrow   ${deployment.raceEscrow}`);
console.log(`deployer ${deployer.address}`);
console.log("");

if (args.status) {
  await printRoster();
  process.exit(0);
}

const [mintFee, driftOwner] = await Promise.all([
  publicClient.readContract({
    address: deployment.carNft,
    abi: carNftAbi,
    functionName: "mintFee",
  }),
  publicClient.readContract({
    address: deployment.driftToken,
    abi: driftTokenAbi,
    functionName: "owner",
  }),
]);

for (const bot of bots) {
  await provision(bot, mintFee);
  await claimWinnings(bot);
}

console.log("\ngrid ready:");
await printRoster();

if (args.setup) process.exit(0);

await adoptPendingRaces();

console.log(
  `\nwatching for open races every ${args.interval / 1000}s — ` +
    `${args.fill ? "taking every seat" : "leaving one seat for you"}. Ctrl-C to stop.\n`
);

for (;;) {
  try {
    await tick();
  } catch (err) {
    console.log(`tick failed: ${reason(err)}`);
  }
  await sleep(args.interval);
}
