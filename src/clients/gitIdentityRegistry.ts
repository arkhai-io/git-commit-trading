import type { ViemClient } from "alkahest-ts";
import { abi as gitIdentityRegistryAbi } from "../contracts/GitIdentityRegistry";

// Enum for KeyType from the contract
export enum KeyType {
	PGPv4 = 0,
	SSHEd25519 = 1,
	SSHSecp256k1 = 2,
	X509 = 3,
}

// Type for the GitKeyClaim data structure
export type GitKeyClaim = {
	keyType: KeyType;
	nonceHash: `0x${string}`;
	sig: `0x${string}`;
	publicKey: string;
};

export type GitIdentityRegistryAddresses = {
	gitIdentityRegistry: `0x${string}`;
};

export const makeGitIdentityRegistryClient = (
	viemClient: ViemClient,
	addresses: GitIdentityRegistryAddresses,
) => {
	const claimKey = async (claim: GitKeyClaim) => {
		const { request } = await viemClient.simulateContract({
			address: addresses.gitIdentityRegistry,
			abi: gitIdentityRegistryAbi.abi,
			functionName: "claimKey",
			args: [claim],
		});

		const hash = await viemClient.writeContract(request);
		return { hash };
	};

	// Get key claims by listening to events from the blockchain
	const getKeyClaims = async (
		claimant: `0x${string}`,
		fromBlock?: bigint,
	): Promise<GitKeyClaim[]> => {
		const events = await viemClient.getLogs({
			address: addresses.gitIdentityRegistry,
			event: {
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
			},
			args: {
				claimant,
			},
			fromBlock: fromBlock || 0n,
			toBlock: "latest",
		});

		return events.map((event) => event.args.claim as GitKeyClaim);
	};

	// Get the most recent key claim for an address
	const getLatestKeyClaim = async (
		claimant: `0x${string}`,
		fromBlock?: bigint,
	): Promise<GitKeyClaim | null> => {
		const claims = await getKeyClaims(claimant, fromBlock);
		return claims.length > 0 ? claims[claims.length - 1]! : null;
	};

	// Check if an address has any key claims
	const hasKeyClaim = async (
		claimant: `0x${string}`,
		fromBlock?: bigint,
	): Promise<boolean> => {
		const claims = await getKeyClaims(claimant, fromBlock);
		return claims.length > 0;
	};

	// Watch for new key claim events in real-time
	const watchKeyClaimEvents = (
		onEvent: (claimant: `0x${string}`, claim: GitKeyClaim) => void,
		claimant?: `0x${string}`, // Optional filter for specific claimant
	) => {
		return viemClient.watchContractEvent({
			address: addresses.gitIdentityRegistry,
			abi: gitIdentityRegistryAbi.abi,
			eventName: "GitKeyClaimed",
			args: claimant ? { claimant } : undefined,
			onLogs: (logs) => {
				logs.forEach((log: any) => {
					const { claimant, claim } = log.args;
					onEvent(claimant as `0x${string}`, claim as GitKeyClaim);
				});
			},
		});
	};

	return {
		claimKey,
		getKeyClaims,
		getLatestKeyClaim,
		hasKeyClaim,
		watchKeyClaimEvents,
	};
};

export type GitIdentityRegistryClient = ReturnType<
	typeof makeGitIdentityRegistryClient
>;

// Helper function to create a proper Git key claim
export function createGitKeyClaim(
	keyType: KeyType,
	nonceHash: string,
	signature: string,
	publicKey: string,
): GitKeyClaim {
	return {
		keyType,
		nonceHash: nonceHash.startsWith("0x")
			? (nonceHash as `0x${string}`)
			: `0x${nonceHash}`,
		sig: signature.startsWith("0x")
			? (signature as `0x${string}`)
			: `0x${signature}`,
		publicKey,
	};
}
