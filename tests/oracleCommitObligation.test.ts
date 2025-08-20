import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { decodeAbiParameters, encodeAbiParameters, parseAbiParameters } from "viem";
import { setupTest } from "./utils/setup";
import { teardownTestEnvironment, type TestContext } from "alkahest-ts/tests/utils/setup";
import { CommitAlgo, type CommitObligationData } from "../src/clients/commitObligation";

describe("Oracle CommitObligation Tests", () => {
    // Test context and variables
    let testContext: TestContext;
    let alice: `0x${string}`;
    let bob: `0x${string}`;
    let aliceClient: any;
    let bobClient: any;
    let testClient: TestContext["testClient"];
    let commitObligationAddress: `0x${string}`;
    beforeAll(async () => {
        const setup = await setupTest();
        testContext = setup.testContext;
        aliceClient = setup.aliceClient;
        bobClient = setup.bobClient;

        // Extract the values we need for tests
        alice = testContext.alice;
        bob = testContext.bob;
        testClient = testContext.testClient;
        commitObligationAddress = setup.commitObligationAddress;
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

    describe("Git App Flow", () => {
        test("Oracle CommitObligation Integration", async () => {
            const encodeCommitTestsDemand = (demand: {
                testsCommitHash: string;
                testsCommand: string;
                testsCommitAlgo: number; // 0 = Sha1, 1 = Sha256
                hosts: string[];
            }) => {
                return encodeAbiParameters(
                    parseAbiParameters("(string testsCommitHash, string testsCommand, uint8 testsCommitAlgo, string[] hosts)"),
                    [demand],
                );
            };

            const arbiter = testContext.addresses.trustedOracleArbiter;
            // 1. Alice create test suit and commit to the git repository
            //  Alice make an escrow deposit, released to anyone who writes a commit that makes the test suite pass

            const commitTestsData = encodeCommitTestsDemand({
                testsCommitHash: "test-sui-commit-hash",
                testsCommand: "npm test",
                testsCommitAlgo: 1, // CommitTestsCommitAlgo.Sha256
                hosts: ["required.host.com"]
            });

            const demand = aliceClient.arbiters.encodeTrustedOracleDemand({
                oracle: testContext.bob,
                data: commitTestsData,
            });

            const { attested: escrow } =
                await aliceClient.erc20.permitAndBuyWithErc20(
                    {
                        address: testContext.mockAddresses.erc20A,
                        value: 10n,
                    },
                    { arbiter, demand },
                    0n,
                );

            // 2. Bob fulfills the escrow by writing a commit that makes the test suite pass
            const { attested: fulfillment } =
                await bobClient.commitObligation.doObligation(
                    {
                        commitHash: "commit hash that makes the test suite pass",
                        commitAlgo: CommitAlgo.SHA256,
                        hosts: ["required.host.com", "additional.host.com"],
                    },
                    escrow.uid,
                );

            await Bun.sleep(150);

            // 2 .a Bob listens for the escrow and fulfills it by writing a commit that makes the test suite pass
            const { unwatch } = await bobClient.oracle.listenAndArbitrateForEscrow({
                escrow: {
                    attester: testContext.addresses.erc20EscrowObligation,
                    demandAbi: parseAbiParameters("(string testsCommitHash, string testsCommand, uint8 testsCommitAlgo, string[] hosts)"),
                },
                fulfillment: {
                    attester: commitObligationAddress,
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

            // // 3. Bob collects the escrow
            // const collectionHash = await bobClient.erc20.collectEscrow(
            //     escrow.uid,
            //     fulfillment.uid,
            // );

            // expect(collectionHash).toBeTruthy();

            // unwatch();
        });
    });

});
