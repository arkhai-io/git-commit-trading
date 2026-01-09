/**
 * Git Identity Registry utilities for fetching and verifying registered keys.
 */

import type { GitIdentityRegistryClient } from "../clients/gitIdentityRegistry.js";
import type { RegisteredKey } from "../test-execution/types.js";
import { verifyGitKeyClaimSignature } from "./signatures.js";

/**
 * Get a registered key for an address from the GitIdentityRegistry.
 * Fetches the latest key claim and verifies the signature before returning.
 *
 * @param registry - GitIdentityRegistry client
 * @param address - Ethereum address to look up
 * @returns RegisteredKey if valid key exists, null otherwise
 */
export async function getRegisteredKey(
	registry: GitIdentityRegistryClient,
	address: `0x${string}`,
): Promise<RegisteredKey | null> {
	try {
		// Fetch the latest key claim from the contract
		const keyClaim = await registry.getLatestKeyClaim(address);
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
