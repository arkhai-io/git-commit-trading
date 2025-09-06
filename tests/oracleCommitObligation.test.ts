import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { decodeAbiParameters, encodeAbiParameters, parseAbiParameters } from "viem";
import { setupTest } from "./utils/setup";
import { teardownTestEnvironment, type TestContext } from "alkahest-ts/tests/utils/setup";
import { CommitAlgo, type CommitObligationData } from "../src/clients/commitObligation";
import { GitTestExecution } from "../src/test-execution/";

describe("Oracle CommitObligation Tests", () => {
    // Test context and variables
    let testContext: TestContext;
    let alice: `0x${string}`;
    let bob: `0x${string}`;
    let oracle: `0x${string}`;
    let aliceClient: any;
    let bobClient: any;
    let arbiterClient: any;
    let commitObligationAddress: `0x${string}`;
    beforeAll(async () => {
        const setup = await setupTest();
        testContext = setup.testContext;
        aliceClient = setup.aliceClient;
        bobClient = setup.bobClient;
        arbiterClient = testContext.charlieClient;

        // Extract the values we need for tests
        alice = testContext.alice;
        bob = testContext.bob;
        oracle = testContext.charlie;
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
        test("Oracle CommitObligation Integration - Python", async () => {
            const encodeCommitTestsDemand = (demand: {
                testsCommitHash: string;
                testsCommitAlgo: number; // 0 = Sha1, 1 = Sha256
                hosts: string[];
            }) => {
                return encodeAbiParameters(
                    parseAbiParameters("(string testsCommitHash, uint8 testsCommitAlgo, string[] hosts)"),
                    [demand],
                );
            };

            const arbiter = testContext.addresses.trustedOracleArbiter;
            // 1. Alice creates Python test suite and commits to the git repository
            //  Alice makes an escrow deposit, released to anyone who writes a commit that makes the test suite pass

            const commitTestsData = encodeCommitTestsDemand({
                testsCommitHash: "6491cdb5f5f9101c026db079283dd59c246d895a", // Alice's updated Python tests commit (duplicate removed)
                testsCommitAlgo: CommitAlgo.SHA256, // Using SHA256 for SHA1 hashes as per existing pattern
                hosts: ["https://github.com/thinhnx-var/testcase-py-alice.git"]
            });

            const demand = aliceClient.arbiters.encodeTrustedOracleDemand({
                oracle,
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

            // 2. Bob fulfills the escrow by writing Python solution that makes the test suite pass
            const { attested: fulfillment } =
                await bobClient.commitObligation.doObligation(
                    {
                        commitHash: "a3b61a4234b335bd2efab78518828d28f97f1ca9", // Bob's Python solution commit
                        commitAlgo: CommitAlgo.SHA256, // Using SHA256 for SHA1 hashes as per existing pattern
                        hosts: ["https://github.com/thinhnx-var/solution-py-bob.git"],
                    },
                    escrow.uid,
                );

            await Bun.sleep(150);

            // 2.a Oracle arbitrates the Python test execution
            const { unwatch } = await arbiterClient.oracle.listenAndArbitrateForEscrow({
                escrow: {
                    attester: testContext.addresses.erc20EscrowObligation,
                    demandAbi: parseAbiParameters("(string testsCommitHash, uint8 testsCommitAlgo, string[] hosts)"),
                },
                fulfillment: {
                    attester: commitObligationAddress,
                    obligationAbi: parseAbiParameters("(string commitHash, uint8 commitAlgo, string[] hosts)"),
                },
                arbitrate: async (obligation: any, demand: any) => {
                    console.log("Arbitrating Python obligation:", obligation, "against demand:", demand);
                    try {
                        const config = GitTestExecution.initConfig();
                        
                        // Configure Python test repository (Alice's tests)
                        config.repositories.testcase.url = demand[0].hosts[0];
                        config.repositories.testcase.commitHash = demand[0].testsCommitHash;

                        // Configure Python solution repository (Bob's solution)
                        config.repositories.source.url = obligation[0].hosts[0];
                        config.repositories.source.commitHash = obligation[0].commitHash;
                        
                        config.execution.timeout = 60000; // 60 seconds for Python setup
                        config.execution.cleanupAfterExecution = true;
                        
                        console.log("Starting Python test execution...");
                        const res = await GitTestExecution.executeTests(config, {
                            onProgress: (step) => console.log(`  → ${step}`)
                        });
                        
                        console.log(`Python execution result: ${res.testResult.success ? 'PASSED' : 'FAILED'}`);
                        if (!res.testResult.success && res.testResult.error) {
                            console.log("Error details:", res.testResult.error);
                        }
                        return res.testResult.success;
                    } catch (error) {
                        console.error("Error during Python test execution:", error);
                        return false;
                    }
                },
                onAfterArbitrate: async (decision: any) => {
                    console.log("Python arbitration decision:", decision);
                },
                pollingInterval: 50,
            });

            // 3. Bob collects the escrow
            const collectionHash = await bobClient.erc20.collectEscrow(
                escrow.uid,
                fulfillment.uid,
            );

            expect(collectionHash).toBeTruthy();
            unwatch();
        }, 30000);

        test("Oracle CommitObligation Integration - Rust", async () => {
            const encodeCommitTestsDemand = (demand: {
                testsCommitHash: string;
                testsCommitAlgo: number; // 0 = Sha1, 1 = Sha256
                hosts: string[];
            }) => {
                return encodeAbiParameters(
                    parseAbiParameters("(string testsCommitHash, uint8 testsCommitAlgo, string[] hosts)"),
                    [demand],
                );
            };

            const arbiter = testContext.addresses.trustedOracleArbiter;
            // 1. Alice creates Rust test suite and commits to the git repository
            //  Alice makes an escrow deposit, released to anyone who writes a commit that makes the test suite pass

            const commitTestsData = encodeCommitTestsDemand({
                testsCommitHash: "f92331a1f4ac99aaacac5018ff631e4fb59595e0", // Alice's Rust tests commit
                testsCommitAlgo: CommitAlgo.SHA256, // Using SHA256 for SHA1 hashes as per existing pattern
                hosts: ["https://github.com/thinhnx-var/testcase-rust-alice.git"]
            });

            const demand = aliceClient.arbiters.encodeTrustedOracleDemand({
                oracle,
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

            // 2. Bob fulfills the escrow by writing Rust solution that makes the test suite pass
            const { attested: fulfillment } =
                await bobClient.commitObligation.doObligation(
                    {
                        commitHash: "687f49b5bbebc70c7bc1944ff17a96063cfdbb45", // Bob's Rust solution commit
                        commitAlgo: CommitAlgo.SHA256, // Using SHA256 for SHA1 hashes as per existing pattern
                        hosts: ["https://github.com/thinhnx-var/solution-rust-bob.git"],
                    },
                    escrow.uid,
                );

            await Bun.sleep(150);

            // 2.a Oracle arbitrates the Rust test execution
            const { unwatch } = await arbiterClient.oracle.listenAndArbitrateForEscrow({
                escrow: {
                    attester: testContext.addresses.erc20EscrowObligation,
                    demandAbi: parseAbiParameters("(string testsCommitHash, uint8 testsCommitAlgo, string[] hosts)"),
                },
                fulfillment: {
                    attester: commitObligationAddress,
                    obligationAbi: parseAbiParameters("(string commitHash, uint8 commitAlgo, string[] hosts)"),
                },
                arbitrate: async (obligation: any, demand: any) => {
                    console.log("Arbitrating Rust obligation:", obligation, "against demand:", demand);
                    try {
                        const config = GitTestExecution.initConfig();
                        
                        // Configure Rust test repository (Alice's tests)
                        config.repositories.testcase.url = demand[0].hosts[0];
                        config.repositories.testcase.commitHash = demand[0].testsCommitHash;
                        // config.repositories.testcase.language = "rust";

                        // Configure Rust solution repository (Bob's solution)
                        config.repositories.source.url = obligation[0].hosts[0];
                        config.repositories.source.commitHash = obligation[0].commitHash;
                        // config.repositories.source.language = "rust";
                        
                        config.execution.timeout = 45000; // 45 seconds for Rust compilation
                        config.execution.cleanupAfterExecution = true;
                        
                        console.log("Starting Rust test execution...");
                        const res = await GitTestExecution.executeTests(config, {
                            onProgress: (step) => console.log(`  → ${step}`)
                        });
                        
                        console.log(`Rust execution result: ${res.testResult.success ? 'PASSED' : 'FAILED'}`);
                        if (!res.testResult.success && res.testResult.error) {
                            console.log("Error details:", res.testResult.error);
                        }
                        return res.testResult.success;
                    } catch (error) {
                        console.error("Error during Rust test execution:", error);
                        return false;
                    }
                },
                onAfterArbitrate: async (decision: any) => {
                    console.log("Rust arbitration decision:", decision);
                },
                pollingInterval: 50,
            });

            // 3. Bob collects the escrow
            const collectionHash = await bobClient.erc20.collectEscrow(
                escrow.uid,
                fulfillment.uid,
            );

            expect(collectionHash).toBeTruthy();
            unwatch();
        }, 30000);

        test("Oracle CommitObligation Integration - Typescript", async () => {
            const encodeCommitTestsDemand = (demand: {
                testsCommitHash: string;
                testsCommitAlgo: number; // 0 = Sha1, 1 = Sha256
                hosts: string[];
            }) => {
                return encodeAbiParameters(
                    parseAbiParameters("(string testsCommitHash, uint8 testsCommitAlgo, string[] hosts)"),
                    [demand],
                );
            };

            const arbiter = testContext.addresses.trustedOracleArbiter;
            // 1. Alice create test suit and commit to the git repository
            //  Alice make an escrow deposit, released to anyone who writes a commit that makes the test suite pass

            const commitTestsData = encodeCommitTestsDemand({
                testsCommitHash: "ab940eceae6702e05b9c03765b7407a054ea84c9",
                testsCommitAlgo: CommitAlgo.SHA256,
                hosts: ["https://github.com/thinhnx-var/testcase-repo-alice.git"]
            });

            const demand = aliceClient.arbiters.encodeTrustedOracleDemand({
                oracle,
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
                        commitHash: "14acbbd4b4795dc5a8178540e32e1aa9661867ea", // success. to be fail use: 11e0ecb39cc93f999cd5b5afb8a93d90ecb0add5
                        commitAlgo: CommitAlgo.SHA256,
                        hosts: ["https://github.com/thinhnx-var/solution-repo-bob.git", "additional.host.com"],
                    },
                    escrow.uid,
                );

            await Bun.sleep(150);

            // 2 .a Bob listens for the escrow and fulfills it by writing a commit that makes the test suite pass
            const { unwatch } = await arbiterClient.oracle.listenAndArbitrateForEscrow({
                escrow: {
                    attester: testContext.addresses.erc20EscrowObligation,
                    demandAbi: parseAbiParameters("(string testsCommitHash, uint8 testsCommitAlgo, string[] hosts)"),
                },
                fulfillment: {
                    attester: commitObligationAddress,
                    obligationAbi: parseAbiParameters("(string commitHash, uint8 commitAlgo, string[] hosts)"),
                },
                arbitrate: async (obligation: any, demand: any) => {
                    console.log("Arbitrating obligation:", obligation, "against demand:", demand);
                    //After Bob writes a commit that makes the test suite pass,
                    //Clone the repository, run the tests, and check if they pass
                    try {
                        // TODO: Change the hardcoded of buildCommand & testCommand to follow the package.json ( if the project is node base)
                        const config = GitTestExecution.initConfig();
                        // rewrite config with data from obligation and demand
                        config.repositories.testcase.url = demand[0].hosts[0];
                        config.repositories.testcase.commitHash = demand[0].testsCommitHash;
                        // config.repositories.testcase.buildCommand = "npm run build";
                        // config.repositories.testcase.testCommand = demand[0].testsCommand;
                        // config.repositories.testcase.testCommand = "bun test";

                        config.repositories.source.url = obligation[0].hosts[0];
                        config.repositories.source.commitHash = obligation[0].commitHash;
                        // config.repositories.source.testCommand = "bun test";
                        // config.repositories.source.installCommand = "npm install";

                        // console.log("Starting test execution with config:", config);
                        
                        // Set a shorter timeout for the execution to prevent hanging
                        config.execution.timeout = 45000; // 45 seconds
                        config.execution.cleanupAfterExecution = true;
                        
                        const res = await GitTestExecution.executeTests(config, {
                            onProgress: (step) => console.log(`  → ${step}`)
                        });
                        console.log("Execution result: ", res.testResult.success);
                        return res.testResult.success;
                    } catch (error) {
                        console.error("Error during test execution:", error);
                        return false; // Return false instead of throwing to allow test to continue
                    }
                },
                onAfterArbitrate: async (decision: any) => {

                },
                pollingInterval: 50,
            });

            // 3. Bob collects the escrow
            const collectionHash = await bobClient.erc20.collectEscrow(
                escrow.uid,
                fulfillment.uid,
            );

            expect(collectionHash).toBeTruthy();

            unwatch();
        }, 20000);
    });

});
