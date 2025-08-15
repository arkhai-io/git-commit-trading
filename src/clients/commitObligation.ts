import {
    decodeAbiParameters,
    encodeAbiParameters,
    parseAbiParameters,
} from "viem";
import { getAttestation, getAttestedEventFromTxHash } from "alkahest-ts";

import { abi as commitObligationAbi } from "../contracts/CommitObligation";
import type { ViemClient } from "alkahest-ts";
import type { ChainAddresses } from "alkahest-ts";

// Enum for CommitAlgo from the contract
export enum CommitAlgo {
    SHA256 = 0,
    MD5 = 1,
}

// Type for the CommitObligation data structure
export type CommitObligationData = {
    commitHash: string;
    commitAlgo: CommitAlgo;
    hosts: string[];
};

export type CommitObligationAddresses = {
    commitObligation: `0x${string}`;
};

export const makeCommitObligationClient = (
    viemClient: ViemClient,
    addresses: CommitObligationAddresses,
) => {
    const decode = (obligationData: `0x${string}`) => {
        return decodeAbiParameters(
            parseAbiParameters("(string commitHash,uint8 commitAlgo,string[] hosts)"),
            obligationData,
        )[0];
    };

    const doObligation = async (
        data: CommitObligationData,
        refUID: `0x${string}` = "0x0000000000000000000000000000000000000000000000000000000000000000"
    ) => {
        const { request } = await viemClient.simulateContract({
            address: addresses.commitObligation,
            abi: commitObligationAbi.abi,
            functionName: "doObligation",
            args: [data, refUID],
        });

        const hash = await viemClient.writeContract(request);
        const attested = await getAttestedEventFromTxHash(viemClient, hash);
        return { hash, attested };
    };

    const getSchema = async () =>
        await viemClient.readContract({
            address: addresses.commitObligation,
            abi: commitObligationAbi.abi,
            functionName: "ATTESTATION_SCHEMA",
        });

    const getObligationData = async (uid: `0x${string}`) => {
        return await viemClient.readContract({
            address: addresses.commitObligation,
            abi: commitObligationAbi.abi,
            functionName: "getObligationData",
            args: [uid],
        });
    };

    return {
        encode: (data: CommitObligationData) => {
            return encodeAbiParameters(
                parseAbiParameters("(string commitHash,uint8 commitAlgo,string[] hosts)"),
                [data]
            );
        },
        decode,
        doObligation,
        getSchema,
        getObligationData,
    };
};
