#!/usr/bin/env node
/**
 * Base Sepolia top-up — Chain Drift
 *
 * Claims testnet ETH from the Coinbase Developer Platform faucet until the
 * deployer wallet reaches a target balance.
 *
 * The CDP faucet API pays **0.0001 ETH per claim**, capped at 1000 claims per
 * 24 hours — the same 0.1 ETH/day the web portal hands over in a single click.
 * So this is the right tool for a scripted or repeated top-up, and the wrong one
 * for a first fill: to reach 0.05 ETH it has to make ~500 requests, where
 * https://portal.cdp.coinbase.com/products/faucet takes one.
 *
 * Usage:
 *   node scripts/faucet.mjs --target 0.05
 *   node scripts/faucet.mjs --address 0x1234... --target 0.02
 *   node scripts/faucet.mjs --claims 10          # fixed number of claims
 *
 * Env (packages/contracts/.env is loaded automatically):
 *   CDP_API_KEY_ID, CDP_API_KEY_SECRET   from https://portal.cdp.coinbase.com
 *   CDP_WALLET_SECRET                    optional; only some SDK paths need it
 *   MNEMONIC, MNEMONIC_INDEX             used when --address is omitted
 */

import {readFileSync, existsSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createPublicClient, formatEther, http} from "viem";
import {baseSepolia} from "viem/chains";
import {mnemonicToAccount} from "viem/accounts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

/** Amount the CDP faucet pays per ETH claim. */
const WEI_PER_CLAIM = 100_000_000_000_000n; // 0.0001 ETH

/** Documented cap. Refuse to exceed it rather than collecting 429s. */
const MAX_CLAIMS_PER_DAY = 1000;

/** Gap between claims. Sequential and unhurried, so this reads as a top-up. */
const DELAY_MS = 250;

// ─── .env loading ───────────────────────────────────────────────────────────

/**
 * Minimal .env reader.
 *
 * Deliberately not a dependency: this file handles a seed phrase, and the fewer
 * third-party packages that touch it the better.
 */
function loadEnv(path) {
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

function parseArgs(argv) {
  const args = {target: null, claims: null, address: null};
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    if (argv[i] === "--target") args.target = next();
    else if (argv[i] === "--claims") args.claims = Number(next());
    else if (argv[i] === "--address") args.address = next();
    else if (argv[i] === "--help" || argv[i] === "-h") args.help = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
  process.exit(0);
}

// ─── Target address ─────────────────────────────────────────────────────────

function resolveAddress() {
  if (args.address) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(args.address)) {
      fail(`--address is not a valid address: ${args.address}`);
    }
    return args.address;
  }

  const mnemonic = process.env.MNEMONIC;
  if (!mnemonic) {
    fail(
      "No --address given and MNEMONIC is not set.\n" +
        "Set MNEMONIC in packages/contracts/.env, or pass --address 0x…"
    );
  }
  const index = Number(process.env.MNEMONIC_INDEX ?? 0);
  // Same BIP-44 path Foundry's deriveKey and the recorder use, so index 0 is
  // always the deployer.
  return mnemonicToAccount(mnemonic, {addressIndex: index}).address;
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

// ─── Main ───────────────────────────────────────────────────────────────────

const address = resolveAddress();

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL ?? baseSepolia.rpcUrls.default.http[0]),
});

const startBalance = await publicClient.getBalance({address});

console.log("─── Base Sepolia top-up ───");
console.log(`address  ${address}`);
console.log(`balance  ${formatEther(startBalance)} ETH`);

// Work out how many claims are needed before asking for credentials, so a
// wallet that is already funded costs nothing to check.
let claimsNeeded;
if (args.claims != null) {
  if (!Number.isInteger(args.claims) || args.claims < 1) {
    fail("--claims must be a positive integer");
  }
  claimsNeeded = args.claims;
} else {
  const target = args.target ?? "0.05";
  let targetWei;
  try {
    const [whole, frac = ""] = String(target).split(".");
    targetWei = BigInt(whole) * 10n ** 18n + BigInt(frac.padEnd(18, "0").slice(0, 18));
  } catch {
    fail(`--target is not a number: ${target}`);
  }

  console.log(`target   ${target} ETH`);

  if (startBalance >= targetWei) {
    console.log("\nAlready at or above target — nothing to do.");
    process.exit(0);
  }

  const shortfall = targetWei - startBalance;
  claimsNeeded = Number((shortfall + WEI_PER_CLAIM - 1n) / WEI_PER_CLAIM);
}

if (claimsNeeded > MAX_CLAIMS_PER_DAY) {
  fail(
    `That target needs ${claimsNeeded} claims, above the documented ` +
      `${MAX_CLAIMS_PER_DAY}/24h cap.\n` +
      "Use https://portal.cdp.coinbase.com/products/faucet instead — the portal " +
      "pays 0.1 ETH in a single claim."
  );
}

console.log(`claims   ${claimsNeeded} x ${formatEther(WEI_PER_CLAIM)} ETH`);

if (claimsNeeded > 50) {
  console.log(
    `\nNote: ${claimsNeeded} API calls at 0.0001 ETH each.\n` +
      "The web portal pays 0.1 ETH in one click: " +
      "https://portal.cdp.coinbase.com/products/faucet"
  );
}

if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET) {
  fail(
    "CDP_API_KEY_ID and CDP_API_KEY_SECRET are not set.\n" +
      "Create a key at https://portal.cdp.coinbase.com and add both to " +
      "packages/contracts/.env."
  );
}

let CdpClient;
try {
  ({CdpClient} = await import("@coinbase/cdp-sdk"));
} catch {
  fail("@coinbase/cdp-sdk is not installed. Run `pnpm install` at the repo root.");
}

const cdp = new CdpClient();

/** Overwrite one line on a terminal; emit periodic lines when piped to a file. */
function reportProgress(done, total) {
  if (process.stdout.isTTY) {
    process.stdout.write(`\rclaimed ${done}/${total}`);
  } else if (done === total || done % 25 === 0) {
    console.log(`claimed ${done}/${total}`);
  }
}

let claimed = 0;
let lastTxHash = null;

for (let i = 0; i < claimsNeeded; i++) {
  try {
    const response = await cdp.evm.requestFaucet({
      address,
      network: "base-sepolia",
      token: "eth",
    });
    claimed++;
    lastTxHash = response?.transactionHash ?? lastTxHash;
    reportProgress(claimed, claimsNeeded);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A rate limit is the expected stopping condition, not a crash: keep
    // whatever already landed and report it.
    console.log(`\n\nStopped after ${claimed} claims: ${message}`);
    break;
  }
  if (i < claimsNeeded - 1) await new Promise((r) => setTimeout(r, DELAY_MS));
}

// `requestFaucet` returns once the claim is accepted, not once it is mined.
// Reading the balance straight away reports the balance from before the run.
if (lastTxHash) {
  console.log("\n\nwaiting for the last claim to be mined...");
  try {
    await publicClient.waitForTransactionReceipt({hash: lastTxHash, timeout: 120_000});
  } catch {
    console.log("(receipt timed out; the balance below may still be catching up)");
  }
}

const endBalance = await publicClient.getBalance({address});
console.log(`\nbalance  ${formatEther(endBalance)} ETH`);
console.log(`gained   ${formatEther(endBalance - startBalance)} ETH`);
