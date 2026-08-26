#!/usr/bin/env node
/**
 * Batch IPFS Pinner — Chain Drift
 *
 * Renders and pins car preview images to Pinata for a range of token IDs.
 * Calls POST /pin/:tokenId on the metadata-api for each token.
 *
 * Usage:
 *   node scripts/pin-all.mjs <from> <to> [--api http://localhost:3001] [--concurrency 2]
 *
 * Example:
 *   node scripts/pin-all.mjs 1 50
 *   node scripts/pin-all.mjs 1 100 --concurrency 3
 *
 * Prerequisites:
 *   1. metadata-api running with PINATA_API_KEY + PINATA_API_SECRET set
 *   2. Frontend running at RENDER_BASE_URL (default http://localhost:5173)
 *   3. puppeteer installed: npm install puppeteer --save-dev (in metadata-api)
 */

import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    api:         { type: "string",  default: "http://localhost:3001" },
    concurrency: { type: "string",  default: "2" },
  },
  allowPositionals: true,
});

const [fromStr, toStr] = positionals;
const from = Number(fromStr);
const to   = Number(toStr);
const API  = values.api;
const CONCURRENCY = Math.max(1, Number(values.concurrency));

if (!from || !to || from > to) {
  console.error("Usage: node scripts/pin-all.mjs <from> <to> [--api URL] [--concurrency N]");
  process.exit(1);
}

const tokenIds = Array.from({ length: to - from + 1 }, (_, i) => from + i);

let pinned = 0;
let failed = 0;
let cached = 0;

async function pinOne(tokenId) {
  const res = await fetch(`${API}/pin/${tokenId}`, { method: "POST" });
  const json = await res.json();

  if (!res.ok) {
    console.error(`  [${tokenId}] FAILED: ${json.error}`);
    failed++;
    return;
  }

  if (json.cached) {
    console.log(`  [${tokenId}] cached → ${json.cid}`);
    cached++;
  } else {
    console.log(`  [${tokenId}] pinned → ${json.cid}`);
    pinned++;
  }
}

async function runBatch(ids, concurrency) {
  let i = 0;
  async function worker() {
    while (i < ids.length) {
      const id = ids[i++];
      await pinOne(id);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}

console.log(`Chain Drift — Batch IPFS Pinner`);
console.log(`Tokens: ${from}–${to} (${tokenIds.length} total)`);
console.log(`API: ${API}  Concurrency: ${CONCURRENCY}`);
console.log(`─────────────────────────────────`);

const start = Date.now();
await runBatch(tokenIds, CONCURRENCY);
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

console.log(`─────────────────────────────────`);
console.log(`Done in ${elapsed}s`);
console.log(`  Pinned:  ${pinned}`);
console.log(`  Cached:  ${cached}`);
console.log(`  Failed:  ${failed}`);
