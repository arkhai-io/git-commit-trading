/**
 * Git Identity Registry utilities for fetching and verifying registered keys.
 */

import { getLatestKeyClaim } from "../clients/gitIdentityRegistry.js";
import type { RegisteredKey } from "../test-execution/types.js";
import { verifyGitKeyClaimSignature } from "./signatures.js";

// Minimal viem client interface needed for getLogs
interface ViemClient {
	getLogs: (args: any) => Promise<any[]>;
}

/**
 * Get a registered key for an address from the GitIdentityRegistry.
 * Fetches the latest key claim and verifies the signature before returning.
 *
 * @param viemClient - Viem client for blockchain queries
 * @param registryAddress - GitIdentityRegistry contract address
 * @param address - Ethereum address to look up
 * @returns RegisteredKey if valid key exists, null otherwise
 */
export async function getRegisteredKey(
	viemClient: ViemClient,
	registryAddress: `0x${string}`,
	address: `0x${string}`,
): Promise<RegisteredKey | null> {
	try {
		// Fetch the latest key claim
		const keyClaim = await getLatestKeyClaim(viemClient, registryAddress, address);
		if (!keyClaim || !keyClaim.publicKey || keyClaim.publicKey.trim() === "") {
			return null;
		}

		// Verify the GitKeyClaim signature
		const isValid = await verifyGitKeyClaimSignature(keyClaim, address);
		if (!isValid) {
			console.log(`GitKeyClaim signature invalid for ${address}`);
			return null;
		}

		return {
			keyType: keyClaim.keyType,
			publicKey: keyClaim.publicKey,
		};
	} catch (error) {
		console.error(`Error fetching key for ${address}:`, error);
		return null;
	}
}
