import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { decodeAbiParameters, encodeAbiParameters, parseAbiParameters } from "viem";
import {
    setupTestEnvironment,
    teardownTestEnvironment,
    type TestContext,
} from "./utils/setup";
import { CommitAlgo, type CommitObligationData } from "../src/clients/commitObligation";

let testContext: TestContext;

beforeAll(async () => {
    testContext = await setupTestEnvironment();
});

beforeEach(async () => {
    // Reset to initial state before each test
    if (testContext.anvilInitState) {
        await testContext.testClient.loadState({
            state: testContext.anvilInitState,
        });
    }
});

afterAll(async () => {
    // Clean up
    await teardownTestEnvironment(testContext);
});


test("Git App Flow", async () => {

    const encodeCommitTestsDemand = (demand: {
        oracle: `0x${string}`;
        testsCommitHash: string;
        testsCommand: string;
        testsCommitAlgo: number; // 0 = Sha1, 1 = Sha256
        hosts: string[];
    }) => {
        return encodeAbiParameters(
            parseAbiParameters("(address oracle, string testsCommitHash, string testsCommand, uint8 testsCommitAlgo, string[] hosts)"),
            [demand],
        );
    };

    /**
     * Decodes CommitTestsArbiter.CommitTestsDemandData from bytes.
     * @param demandData - CommitTestsDemandData as abi encoded bytes
     * @returns the decoded CommitTestsDemandData object
     */
    const decodeCommitTestsDemand = (demandData: `0x${string}`) => {
        return decodeAbiParameters(
            parseAbiParameters("(address oracle, string testsCommitHash, string testsCommand, uint8 testsCommitAlgo, string[] hosts)"),
            demandData,
        )[0];
    }
    const arbiter = testContext.addresses.trustedOracleArbiter;
    // 1. Alice create test suit and commit to the git repository
    //  Alice make an escrow deposit, released to anyone who writes a commit that makes the test suite pass

    const commitTestsData = encodeCommitTestsDemand({
        oracle: testContext.bob,
        testsCommitHash: "test-sui-commit-hash",
        testsCommand: "npm test",
        testsCommitAlgo: 1, // CommitTestsCommitAlgo.Sha256
        hosts: ["required.host.com"]
    });
    const demand = testContext.aliceClient.arbiters.encodeTrustedOracleDemand({
        oracle: testContext.bob,
        data: commitTestsData,
    });

    const { attested: escrow } =
        await testContext.aliceClient.erc20.permitAndBuyWithErc20(
            {
                address: testContext.mockAddresses.erc20A,
                value: 10n,
            },
            { arbiter, demand },
            0n,
        );

    // 2. Bob fulfills the escrow by writing a commit that makes the test suite pass
    const { attested: fulfillment } =
        await testContext.bobClient.commitObligation.doObligation(
            {
                commitHash: "commit hash that makes the test suite pass",
                commitAlgo: CommitAlgo.SHA256,
                hosts: ["required.host.com", "additional.host.com"],
            },
            escrow.uid,
        );

    await Bun.sleep(150);


    // 2 .a Bob listens for the escrow and fulfills it by writing a commit that makes the test suite pass
    const { unwatch } = await testContext.bobClient.oracle.listenAndArbitrateForEscrow({
        escrow: {
            attester: testContext.addresses.erc20EscrowObligation,
            demandAbi: parseAbiParameters("(address oracle, string testsCommitHash, string testsCommand, uint8 testsCommitAlgo, string[] hosts)"),
        },
        fulfillment: {
            attester: testContext.addresses.commitObligation,
            obligationAbi: parseAbiParameters("(string commitHash,uint8 commitAlgo,string[] hosts)"),
        },
        arbitrate: async (obligation: any, demand: any) => {
            console.log("Arbitrating obligation:", obligation, "against demand:", demand);
            //After Bob writes a commit that makes the test suite pass,
            //Clone the repository, run the tests, and check if they pass
            return true;
        },
        onAfterArbitrate: async (decision: any) => {

        },
        pollingInterval: 50,
    });

    // 3. Bob collects the escrow
    const collectionHash = await testContext.bobClient.erc20.collectEscrow(
        escrow.uid,
        fulfillment.uid,
    );

    expect(collectionHash).toBeTruthy();

    unwatch();
});
