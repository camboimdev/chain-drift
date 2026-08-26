/**
 * Pinata IPFS Upload — Chain Drift
 *
 * Uses Pinata's REST API to pin car preview PNG files.
 * No SDK dependency — plain fetch.
 *
 * Required env vars:
 *   PINATA_API_KEY     — from app.pinata.cloud/developers/api-keys
 *   PINATA_API_SECRET  — same page
 */

const PINATA_API = "https://api.pinata.cloud";

function getPinataHeaders(): Record<string, string> {
  const key = process.env.PINATA_API_KEY;
  const secret = process.env.PINATA_API_SECRET;
  if (!key || !secret) {
    throw new Error(
      "Missing PINATA_API_KEY or PINATA_API_SECRET. " +
      "Set them in metadata-api/.env"
    );
  }
  return {
    "pinata_api_key": key,
    "pinata_secret_api_key": secret,
  };
}

/**
 * Pin a PNG buffer to IPFS via Pinata.
 * Returns the IPFS CID (e.g. "QmXyz...").
 */
export async function pinPngToIpfs(
  pngBuffer: Buffer,
  tokenId: number
): Promise<string> {
  const headers = getPinataHeaders();

  // Build multipart form data
  const form = new FormData();
  const blob = new Blob([pngBuffer], { type: "image/png" });
  form.append("file", blob, `${tokenId}.png`);
  form.append(
    "pinataMetadata",
    JSON.stringify({ name: `chain-drift-car-${tokenId}.png` })
  );
  form.append(
    "pinataOptions",
    JSON.stringify({ cidVersion: 1 })
  );

  const res = await fetch(`${PINATA_API}/pinning/pinFileToIPFS`, {
    method: "POST",
    headers, // multipart boundary added automatically by fetch
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pinata upload failed (${res.status}): ${text}`);
  }

  const json = await res.json() as { IpfsHash: string };
  return json.IpfsHash;
}

/**
 * Test Pinata credentials. Throws if invalid.
 */
export async function testPinataAuth(): Promise<void> {
  const headers = getPinataHeaders();
  const res = await fetch(`${PINATA_API}/data/testAuthentication`, {
    headers,
  });
  if (!res.ok) throw new Error(`Pinata auth failed: ${res.statusText}`);
}
