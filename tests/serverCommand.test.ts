import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { setupTest } from "./utils/setup";
import { teardownTestEnvironment, type TestContext } from "alkahest-ts/tests/utils/setup";
import { CommitAlgo } from "../src/clients/commitObligation";
import { spawn } from "child_process";
import path from "path";
import { tmpdir } from "os";
import { promises as fs } from "fs";

describe("Server Command Tests", () => {
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
        console.log("Setting up test environment...");
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
        
        console.log("Test environment setup complete!");
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

    describe("Oracle Functions (Direct Testing)", () => {
        test("should arbitrate past obligations using arbitratePastForEscrow", async () => {
            const encodeCommitTestsDemand = (demand: {
                testsCommitHash: string;
                testsCommand: string;
                testsCommitAlgo: number;
                hosts: string[];
            }) => {
                return encodeAbiParameters(
                    parseAbiParameters("(string testsCommitHash, string testsCommand, uint8 testsCommitAlgo, string[] hosts)"),
                    [demand],
                );
            };

            const arbiter = testContext.addresses.trustedOracleArbiter;

            // 1. Alice creates an escrow
            const commitTestsData = encodeCommitTestsDemand({
                testsCommitHash: "ab940eceae6702e05b9c03765b7407a054ea84c9",
                testsCommand: "npm test",
                testsCommitAlgo: CommitAlgo.SHA256,
                hosts: ["https://github.com/thinhnx-var/testcase-repo-alice.git"]
            });

            const demand = aliceClient.arbiters.encodeTrustedOracleDemand({
                oracle,
                data: commitTestsData,
            });

            const { attested: escrow } = await aliceClient.erc20.permitAndBuyWithErc20(
                {
                    address: testContext.mockAddresses.erc20A,
                    value: 10n,
                },
                { arbiter, demand },
                0n,
            );

            // 2. Bob fulfills the escrow
            const { attested: fulfillment } = await bobClient.commitObligation.doObligation(
                {
                    commitHash: "14acbbd4b4795dc5a8178540e32e1aa9661867ea",
                    commitAlgo: CommitAlgo.SHA256,
                    hosts: ["https://github.com/thinhnx-var/solution-repo-bob.git"],
                },
                escrow.uid,
            );

            // Wait a bit for the transactions to be mined
            await Bun.sleep(500);

            console.log("Testing arbitratePastForEscrow function...");

            // 3. Test the arbitratePastForEscrow function directly
            const arbitrationResult = await arbiterClient.oracle.arbitratePastForEscrow({
                escrow: {
                    attester: arbiterClient.contractAddresses.erc20EscrowObligation,
                    demandAbi: parseAbiParameters("(string testsCommitHash, string testsCommand, uint8 testsCommitAlgo, string[] hosts)"),
                },
                fulfillment: {
                    attester: commitObligationAddress,
                    obligationAbi: parseAbiParameters("(string commitHash,uint8 commitAlgo,string[] hosts)"),
                },
                arbitrate: async (obligation: any, demand: any) => {
                    console.log("  → Running arbitration logic");
                    console.log("  → Obligation:", obligation[0]);
                    console.log("  → Demand:", demand[0]);
                    
                    // Simple test: check if both commitHash and testsCommitHash are provided
                    const hasValidObligation = obligation[0]?.commitHash && obligation[0]?.hosts?.length > 0;
                    const hasValidDemand = demand[0]?.testsCommitHash && demand[0]?.hosts?.length > 0;
                    
                    return hasValidObligation && hasValidDemand;
                },
                onAfterArbitrate: async (decision: any) => {
                    console.log("  → Arbitration completed:", decision.decision ? 'PASSED' : 'FAILED');
                    console.log("  → Transaction Hash:", decision.hash);
                }
            });

            expect(arbitrationResult).toBeDefined();
            expect(arbitrationResult.decisions).toBeDefined();
            expect(arbitrationResult.decisions.length).toBeGreaterThan(0);
            
            console.log(`✓ Successfully arbitrated ${arbitrationResult.decisions.length} past obligation(s)`);
        }, 60000); // 1 minute timeout

        test("should listen for new obligations using listenAndArbitrateForEscrow", async () => {
            console.log("Testing listenAndArbitrateForEscrow function...");

            let arbitrationCalled = false;
            let arbitrationResult: any = null;

            // Start listening for new obligations
            const { unwatch } = await arbiterClient.oracle.listenAndArbitrateForEscrow({
                escrow: {
                    attester: arbiterClient.contractAddresses.erc20EscrowObligation,
                    demandAbi: parseAbiParameters("(string testsCommitHash, string testsCommand, uint8 testsCommitAlgo, string[] hosts)"),
                },
                fulfillment: {
                    attester: commitObligationAddress,
                    obligationAbi: parseAbiParameters("(string commitHash,uint8 commitAlgo,string[] hosts)"),
                },
                arbitrate: async (obligation: any, demand: any) => {
                    console.log("  → New obligation detected! Running arbitration logic");
                    console.log("  → Obligation:", obligation[0]);
                    console.log("  → Demand:", demand[0]);
                    
                    arbitrationCalled = true;
                    
                    // Simple test: check if both commitHash and testsCommitHash are provided
                    const hasValidObligation = obligation[0]?.commitHash && obligation[0]?.hosts?.length > 0;
                    const hasValidDemand = demand[0]?.testsCommitHash && demand[0]?.hosts?.length > 0;
                    
                    return hasValidObligation && hasValidDemand;
                },
                onAfterArbitrate: async (decision: any) => {
                    console.log("  → Arbitration completed:", decision.decision ? 'PASSED' : 'FAILED');
                    console.log("  → Transaction Hash:", decision.hash);
                    arbitrationResult = decision;
                }
            });

            // Wait a bit for the listener to set up
            await Bun.sleep(1000);

            const encodeCommitTestsDemand = (demand: {
                testsCommitHash: string;
                testsCommand: string;
                testsCommitAlgo: number;
                hosts: string[];
            }) => {
                return encodeAbiParameters(
                    parseAbiParameters("(string testsCommitHash, string testsCommand, uint8 testsCommitAlgo, string[] hosts)"),
                    [demand],
                );
            };

            const arbiter = testContext.addresses.trustedOracleArbiter;

            // 1. Alice creates an escrow (while listener is active)
            const commitTestsData = encodeCommitTestsDemand({
                testsCommitHash: "ab940eceae6702e05b9c03765b7407a054ea84c9",
                testsCommand: "npm test",
                testsCommitAlgo: CommitAlgo.SHA256,
                hosts: ["https://github.com/thinhnx-var/testcase-repo-alice.git"]
            });

            const demand = aliceClient.arbiters.encodeTrustedOracleDemand({
                oracle,
                data: commitTestsData,
            });

            const { attested: escrow } = await aliceClient.erc20.permitAndBuyWithErc20(
                {
                    address: testContext.mockAddresses.erc20A,
                    value: 10n,
                },
                { arbiter, demand },
                0n,
            );

            // 2. Bob fulfills the escrow (should trigger the listener)
            const { attested: fulfillment } = await bobClient.commitObligation.doObligation(
                {
                    commitHash: "14acbbd4b4795dc5a8178540e32e1aa9661867ea",
                    commitAlgo: CommitAlgo.SHA256,
                    hosts: ["https://github.com/thinhnx-var/solution-repo-bob.git"],
                },
                escrow.uid,
            );

            // Wait for the listener to process the event
            await Bun.sleep(10000);

            // Stop listening
            unwatch();

            expect(arbitrationCalled).toBe(true);
            expect(arbitrationResult).toBeDefined();
            expect(arbitrationResult.decision).toBeDefined();
            
            console.log("✓ Successfully listened and arbitrated new obligation");
        }, 90000); // 1.5 minute timeout
    });

    describe("CLI Validation", () => {
        test("should show help for server command", async () => {
            const result = await runCLICommand(['server', '--help']);
            
            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Run the arbiter server to listen and arbitrate escrows');
            expect(result.stdout).toContain('--past');
            expect(result.stdout).toContain('--listen');
        });

        test("should require either --past or --listen flag", async () => {
            const result = await runCLICommand(['server']);
            
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain('Must specify either --past or --listen mode');
        });

        test("should reject both --past and --listen flags", async () => {
            const result = await runCLICommand(['server', '--past', '--listen']);
            
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain('Cannot use both --past and --listen options at the same time');
        });

        test("should require .env file", async () => {
            // Make sure there's no .env file
            try {
                await fs.unlink('/Users/thinhnx/Work/varmeta/coophive/git-deal/git-app/.env');
            } catch (error) {
                // Ignore if file doesn't exist
            }

            const result = await runCLICommand(['server', '--past']);
            
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain('.env file not found');
        });
    });
});

// Helper function for running CLI commands
async function runCLICommand(args: string[], timeoutMs: number = 10000): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
}> {
    return new Promise((resolve) => {
        const child = spawn('bun', ['run', 'src/cli/git-escrows.ts', ...args], {
            cwd: '/Users/thinhnx/Work/varmeta/coophive/git-deal/git-app',
            stdio: 'pipe'
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            resolve({
                exitCode: code || 0,
                stdout,
                stderr
            });
        });

        // Kill after timeout
        setTimeout(() => {
            child.kill('SIGTERM');
            setTimeout(() => {
                child.kill('SIGKILL');
            }, 1000);
        }, timeoutMs);
    });
}
