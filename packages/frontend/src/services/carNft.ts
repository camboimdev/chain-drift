// ─── CarNFT Contract Interactions ─────────────────────────────────────────
//
// Minting costs DRIFT, so a mint is `approve` + `mint`. `ensureAllowance`
// skips the approval when a previous one still covers the fee.

import { carNftAbi } from "@chain-drift/shared";
import { readContract, waitForTransactionReceipt, writeContract } from "@wagmi/core";
import { formatEther, parseEventLogs, type Log } from "viem";
import { CAR_NFT_ADDRESS, requireAddress } from "../config/chain";
import { wagmiConfig } from "../config/wagmi";
import { ensureAllowance } from "./driftToken";

function carNftAddress(): `0x${string}` {
  return requireAddress(CAR_NFT_ADDRESS, "VITE_CAR_NFT_ADDRESS");
}

/** Mint fee in wei, read from the contract rather than hardcoded. */
export async function fetchMintFee(): Promise<bigint> {
  return readContract(wagmiConfig, {
    address: carNftAddress(),
    abi: carNftAbi,
    functionName: "mintFee",
  });
}

/** Mint fee in full DRIFT units, for display. */
export async function fetchMintFeeDrift(): Promise<number> {
  return Number(formatEther(await fetchMintFee()));
}

/**
 * Mint one car. Approves DRIFT first when the allowance is short.
 *
 * Nothing about the car is chosen here: the token ID the contract hands out
 * resolves against the collection manifest, which decides the model, the
 * rarity and the traits.
 */
export async function mintCar(
  owner: `0x${string}`
): Promise<{ txHash: `0x${string}`; tokenId: bigint | null }> {
  const address = carNftAddress();
  const fee = await fetchMintFee();

  await ensureAllowance(owner, address, fee);

  const txHash = await writeContract(wagmiConfig, {
    address,
    abi: carNftAbi,
    functionName: "mint",
  });
  const receipt = await waitForTransactionReceipt(wagmiConfig, { hash: txHash });

  return { txHash, tokenId: extractMintedTokenId([...receipt.logs], address) };
}

/** Token IDs owned by `address`. */
export async function fetchOwnedTokenIds(address: `0x${string}`): Promise<bigint[]> {
  const tokenIds = await readContract(wagmiConfig, {
    address: carNftAddress(),
    abi: carNftAbi,
    functionName: "tokensOfOwner",
    args: [address],
  });
  return [...tokenIds];
}

/** Every non-stock slot on a car, as a `{ slot: partId }` map. */
export async function fetchEquippedParts(
  tokenId: bigint
): Promise<Record<string, string>> {
  const [slots, partIds] = await readContract(wagmiConfig, {
    address: carNftAddress(),
    abi: carNftAbi,
    functionName: "getEquippedParts",
    args: [tokenId],
  });

  const equipped: Record<string, string> = {};
  slots.forEach((slot, i) => {
    equipped[slot] = partIds[i];
  });
  return equipped;
}

export async function equipPart(
  tokenId: bigint,
  slot: string,
  partId: string
): Promise<`0x${string}`> {
  const hash = await writeContract(wagmiConfig, {
    address: carNftAddress(),
    abi: carNftAbi,
    functionName: "equipPart",
    args: [tokenId, slot, partId],
  });
  await waitForTransactionReceipt(wagmiConfig, { hash });
  return hash;
}

export async function unequipPart(tokenId: bigint, slot: string): Promise<`0x${string}`> {
  const hash = await writeContract(wagmiConfig, {
    address: carNftAddress(),
    abi: carNftAbi,
    functionName: "unequipPart",
    args: [tokenId, slot],
  });
  await waitForTransactionReceipt(wagmiConfig, { hash });
  return hash;
}

/**
 * Pull the new token ID out of the `CarMinted` log.
 *
 * `writeContract` only returns a hash, and the token ID is what the garage
 * needs to render the car immediately instead of re-fetching everything.
 */
function extractMintedTokenId(
  logs: Log[],
  contractAddress: `0x${string}`
): bigint | null {
  const events = parseEventLogs({
    abi: carNftAbi,
    eventName: "CarMinted",
    logs,
  });
  const minted = events.find(
    (e) => e.address.toLowerCase() === contractAddress.toLowerCase()
  );
  return minted?.args.tokenId ?? null;
}
