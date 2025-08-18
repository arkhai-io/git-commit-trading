import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { decodeAbiParameters, encodeAbiParameters, parseAbiParameters } from "viem";
import {
    setupTestEnvironment,
    teardownTestEnvironment,
    type TestContext,
} from "./utils/setup";
import { CommitAlgo, type CommitObligationData } from "../src/clients/commitObligation";
import { GitTestExecution } from "testExecution";

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


// test("Git App Flow", async () => {

//     const encodeCommitTestsDemand = (demand: {
//         oracle: `0x${string}`;
//         testsCommitHash: string;
//         testsCommand: string;
//         testsCommitAlgo: number; // 0 = Sha1, 1 = Sha256
//         hosts: string[];
//     }) => {
//         return encodeAbiParameters(
//             parseAbiParameters("(address oracle, string testsCommitHash, string testsCommand, uint8 testsCommitAlgo, string[] hosts)"),
//             [demand],
//         );
//     };

//     /**
//      * Decodes CommitTestsArbiter.CommitTestsDemandData from bytes.
//      * @param demandData - CommitTestsDemandData as abi encoded bytes
//      * @returns the decoded CommitTestsDemandData object
//      */
//     const decodeCommitTestsDemand = (demandData: `0x${string}`) => {
//         return decodeAbiParameters(
//             parseAbiParameters("(address oracle, string testsCommitHash, string testsCommand, uint8 testsCommitAlgo, string[] hosts)"),
//             demandData,
//         )[0];
//     }
//     const arbiter = testContext.addresses.trustedOracleArbiter;
//     // 1. Alice create test suit and commit to the git repository
//     //  Alice make an escrow deposit, released to anyone who writes a commit that makes the test suite pass

//     const commitTestsData = encodeCommitTestsDemand({
//         oracle: testContext.bob,
//         testsCommitHash: "test-sui-commit-hash",
//         testsCommand: "npm test",
//         testsCommitAlgo: 1, // CommitTestsCommitAlgo.Sha256
//         hosts: ["required.host.com"]
//     });
//     const demand = testContext.aliceClient.arbiters.encodeTrustedOracleDemand({
//         oracle: testContext.bob,
//         data: commitTestsData,
//     });

//     const { attested: escrow } =
//         await testContext.aliceClient.erc20.permitAndBuyWithErc20(
//             {
//                 address: testContext.mockAddresses.erc20A,
//                 value: 10n,
//             },
//             { arbiter, demand },
//             0n,
//         );

//     // 2. Bob fulfills the escrow by writing a commit that makes the test suite pass
//     const { attested: fulfillment } =
//         await testContext.bobClient.commitObligation.doObligation(
//             {
//                 commitHash: "commit hash that makes the test suite pass",
//                 commitAlgo: CommitAlgo.SHA256,
//                 hosts: ["required.host.com", "additional.host.com"],
//             },
//             escrow.uid,
//         );

//     await Bun.sleep(150);


//     // 2 .a Bob listens for the escrow and fulfills it by writing a commit that makes the test suite pass
//     const { unwatch } = await testContext.bobClient.oracle.listenAndArbitrateForEscrow({
//         escrow: {
//             attester: testContext.addresses.erc20EscrowObligation,
//             demandAbi: parseAbiParameters("(address oracle, string testsCommitHash, string testsCommand, uint8 testsCommitAlgo, string[] hosts)"),
//         },
//         fulfillment: {
//             attester: testContext.addresses.commitObligation,
//             obligationAbi: parseAbiParameters("(string commitHash,uint8 commitAlgo,string[] hosts)"),
//         },
//         arbitrate: async (obligation: any, demand: any) => {
//             console.log("Arbitrating obligation:", obligation, "against demand:", demand);
//             //After Bob writes a commit that makes the test suite pass,
//             //Clone the repository, run the tests, and check if they pass
//             return true;
//         },
//         onAfterArbitrate: async (decision: any) => {

//         },
//         pollingInterval: 50,
//     });

//     // 3. Bob collects the escrow
//     const collectionHash = await testContext.bobClient.erc20.collectEscrow(
//         escrow.uid,
//         fulfillment.uid,
//     );

//     expect(collectionHash).toBeTruthy();

//     unwatch();
// });


test("Integration with test execution", async () => {

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
        testsCommitHash: "ab940eceae6702e05b9c03765b7407a054ea84c9",
        testsCommand: "npm test",
        testsCommitAlgo: 0, // CommitTestsCommitAlgo.Sha256
        hosts: ["https://github.com/thinhnx-var/testcase-repo-alice.git"]
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
                commitHash: "14acbbd4b4795dc5a8178540e32e1aa9661867ea", // success. to be fail use: 11e0ecb39cc93f999cd5b5afb8a93d90ecb0add5
                commitAlgo: CommitAlgo.SHA256,
                hosts: ["https://github.com/thinhnx-var/solution-repo-bob.git", "additional.host.com"],
            },
            escrow.uid,
        );

    await Bun.sleep(150);


        await Bun.sleep(150);

    // 2 .a Bob listens for the escrow and fulfills it by writing a commit that makes the test suite pass
    console.log("Setting up oracle listener...");
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
            
            try {
                const config = GitTestExecution.initConfig();
                // rewrite config with data from obligation and demand
                config.repositories.testcase.url = demand[0].hosts[0];
                config.repositories.testcase.commitHash = demand[0].testsCommitHash;
                config.repositories.testcase.buildCommand = "npm run build";
                config.repositories.testcase.testCommand = demand[0].testsCommand;

                config.repositories.source.url = obligation[0].hosts[0];
                config.repositories.source.commitHash = obligation[0].commitHash;
                config.repositories.source.testCommand = obligation[0].testsCommand;
                config.repositories.source.installCommand = "npm install"

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
            console.log("Arbitration completed with decision:", decision);
        },
        pollingInterval: 50,
    });

    await Bun.sleep(5000); // Wait 5 seconds

    // 3. Bob collects the escrow
    console.log("Collecting escrow...");
    const collectionHash = await testContext.bobClient.erc20.collectEscrow(
        escrow.uid,
        fulfillment.uid,
    );

    expect(collectionHash).toBeTruthy();

    unwatch();
}, 20000); // Increased timeout to 60 seconds for Git operations
