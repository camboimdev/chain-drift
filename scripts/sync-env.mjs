#!/usr/bin/env node
/**
 * Propagate deployed addresses — Chain Drift
 *
 * Reads `packages/contracts/deployments/<chainId>.json` and writes the addresses
 * into the frontend's `.env.local` and the recorder's `.env`, creating either
 * from its `.env.example` when missing.
 *
 * Every redeploy changes four addresses in two files. Copying them by hand is
 * how a frontend ends up silently pointed at a previous deployment.
 *
 * Usage:
 *   node scripts/sync-env.mjs                 # defaults to Base Sepolia
 *   node scripts/sync-env.mjs --chain-id 8453
 */

import {copyFileSync, existsSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const chainIdArg = process.argv.indexOf("--chain-id");
const chainId = chainIdArg === -1 ? "84532" : process.argv[chainIdArg + 1];

const deploymentPath = resolve(repoRoot, `packages/contracts/deployments/${chainId}.json`);
if (!existsSync(deploymentPath)) {
  console.error(`\nNo deployment for chain ${chainId} at ${deploymentPath}`);
  console.error("Run the deploy script first.\n");
  process.exit(1);
}

const d = JSON.parse(readFileSync(deploymentPath, "utf8"));

/**
 * Rewrite `KEY=` lines in place, appending any that are absent.
 *
 * In-place keeps every other setting — a custom RPC, an API key — untouched,
 * which a regenerate-from-template approach would silently drop.
 */
function applyEnv(path, updates) {
  const lines = readFileSync(path, "utf8").split("\n");
  const remaining = new Map(Object.entries(updates));

  const rewritten = lines.map((line) => {
    const match = line.match(/^\s*#?\s*([A-Z0-9_]+)\s*=/);
    if (!match) return line;
    const key = match[1];
    if (!remaining.has(key)) return line;
    const value = remaining.get(key);
    remaining.delete(key);
    return `${key}=${value}`;
  });

  for (const [key, value] of remaining) {
    rewritten.push(`${key}=${value}`);
  }

  writeFileSync(path, rewritten.join("\n"));
}

function ensureFrom(path, examplePath) {
  if (!existsSync(path)) {
    copyFileSync(examplePath, path);
    console.log(`  created from ${examplePath.replace(repoRoot + "/", "")}`);
  }
}

// ─── Frontend ───────────────────────────────────────────────────────────────

const frontendEnv = resolve(repoRoot, "packages/frontend/.env.local");
console.log("packages/frontend/.env.local");
ensureFrom(frontendEnv, resolve(repoRoot, "packages/frontend/.env.example"));
applyEnv(frontendEnv, {
  VITE_CHAIN_ID: chainId,
  VITE_DRIFT_TOKEN_ADDRESS: d.driftToken,
  VITE_CAR_NFT_ADDRESS: d.carNft,
  VITE_RACE_ESCROW_ADDRESS: d.raceEscrow,
  VITE_LEADERBOARD_ADDRESS: d.leaderboard,
});
console.log("  4 addresses written");

// ─── Recorder ───────────────────────────────────────────────────────────────

const oracleEnv = resolve(repoRoot, "packages/oracle/.env");
console.log("packages/oracle/.env");
ensureFrom(oracleEnv, resolve(repoRoot, "packages/oracle/.env.example"));
applyEnv(oracleEnv, {
  CHAIN_ID: chainId,
  RACE_ESCROW_ADDRESS: d.raceEscrow,
  LEADERBOARD_ADDRESS: d.leaderboard,
});
console.log("  2 addresses written");

console.log("\nThe recorder still needs MNEMONIC in packages/oracle/.env.");
