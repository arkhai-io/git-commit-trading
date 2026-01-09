/**
 * Git Identity Registry utilities for fetching and verifying registered keys.
 */

import type { GitKeyClaim } from "../clients/gitIdentityRegistry.js";
import type { RegisteredKey } from "../test-execution/types.js";
import { verifyGitKeyClaimSignature } from "./signatures.js";

// Minimal viem client interface needed for getLogs
interface ViemClient {
	getLogs: (args: any) => Promise<any[]>;
}

const GIT_KEY_CLAIMED_EVENT = {
	type: "event",
	name: "GitKeyClaimed",
	inputs: [
		{ name: "claimant", type: "address", indexed: true },
		{
			name: "claim",
			type: "tuple",
			components: [
				{ name: "keyType", type: "uint8" },
				{ name: "nonceHash", type: "bytes32" },
				{ name: "sig", type: "bytes" },
				{ name: "publicKey", type: "string" },
			],
		},
	],
} as const;

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
		// Fetch key claim events for this address
		const events = await viemClient.getLogs({
			address: registryAddress,
			event: GIT_KEY_CLAIMED_EVENT,
			args: { claimant: address },
			fromBlock: 0n,
			toBlock: "latest",
		});

		if (events.length === 0) {
			return null;
		}

		// Get the latest claim
		const keyClaim = events[events.length - 1]!.args.claim as GitKeyClaim;
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
