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
    nonceHash: `0x${string}`;
    sig: `0x${string}`;
    publicKey: string;
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

    const getKeyClaim = async (addr: `0x${string}`) => {
        return await viemClient.readContract({
            address: addresses.gitIdentityRegistry,
            abi: gitIdentityRegistryAbi.abi,
            functionName: "getKeyClaim",
            args: [addr],
        });
    };

    return {
        claimKey,
        getKeyClaim,
    };
};


// Helper function to create a proper Git key claim
export function createGitKeyClaim(
    keyType: KeyType,
    nonceHash: string,
    signature: string,
    publicKey: string
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
