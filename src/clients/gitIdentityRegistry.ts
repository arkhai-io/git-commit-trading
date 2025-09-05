import { abi as gitIdentityRegistryAbi } from "../contracts/GitIdentityRegistry";
import type { ViemClient } from "alkahest-ts/src/utils";

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
    fingerprint: `0x${string}`;
    nonceHash: `0x${string}`;
    sig: `0x${string}`;
};

export type GitIdentityRegistryAddresses = {
    gitIdentityRegistry: `0x${string}`;
};

export const makeGitIdentityRegistryClient = (
    viemClient: ViemClient,
    addresses: GitIdentityRegistryAddresses
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

    const getClaimant = async (fingerprint: `0x${string}`) => {
        return await viemClient.readContract({
            address: addresses.gitIdentityRegistry,
            abi: gitIdentityRegistryAbi.abi,
            functionName: "getClaimant",
            args: [fingerprint],
        });
    };

    const fingerprintToAddress = async (fingerprint: `0x${string}`) => {
        return await viemClient.readContract({
            address: addresses.gitIdentityRegistry,
            abi: gitIdentityRegistryAbi.abi,
            functionName: "fingerprintToAddress",
            args: [fingerprint],
        });
    };

    return {
        claimKey,
        getClaimant,
        fingerprintToAddress,
    };
};

// Helper function to create a proper Git key claim
export function createGitKeyClaim(
    keyType: KeyType,
    fingerprint: string,
    nonceHash: string,
    signature: string
): GitKeyClaim {
    return {
        keyType,
        fingerprint: fingerprint.startsWith("0x")
            ? (fingerprint as `0x${string}`)
            : `0x${fingerprint}`,
        nonceHash: nonceHash.startsWith("0x")
            ? (nonceHash as `0x${string}`)
            : `0x${nonceHash}`,
        sig: signature.startsWith("0x")
            ? (signature as `0x${string}`)
            : `0x${signature}`,
    };
}
