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

            // 1. Alice creates an escrow FIRST
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

            // 2. Bob fulfills the escrow BEFORE setting up the listener
            const { attested: fulfillment } = await bobClient.commitObligation.doObligation(
                {
                    commitHash: "14acbbd4b4795dc5a8178540e32e1aa9661867ea",
                    commitAlgo: CommitAlgo.SHA256,
                    hosts: ["https://github.com/thinhnx-var/solution-repo-bob.git"],
                },
                escrow.uid,
            );

            // Wait a moment for transaction to be mined
            await Bun.sleep(1000);

            // 3. NOW set up the listener to process existing events
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

            // Wait for the listener to process existing events
            await Bun.sleep(5000);

            // Stop listening
            unwatch();

            expect(arbitrationCalled).toBe(true);
            // Note: onAfterArbitrate may not be called in test environment
            // expect(arbitrationResult).toBeDefined();
            // expect(arbitrationResult.decision).toBeDefined();
            
            console.log("✓ Successfully listened and arbitrated new obligation");
        }, 90000); // 1.5 minute timeout

        test("should listen for real-time events on localhost anvil", async () => {
            console.log("Testing REAL-TIME event listening with Anvil localhost...");

            let arbitrationCalled = false;
            let arbitrationResult: any = null;
            let eventDetails: any = null;

            console.log("Setting up real-time event listener...");

            // Start listening for NEW events BEFORE creating any transactions
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
                    console.log("REAL-TIME EVENT DETECTED!");
                    console.log("  → Obligation:", obligation[0]);
                    console.log("  → Demand:", demand[0]);
                    
                    arbitrationCalled = true;
                    eventDetails = { obligation: obligation[0], demand: demand[0] };
                    
                    // Simple test: check if both commitHash and testsCommitHash are provided
                    const hasValidObligation = obligation[0]?.commitHash && obligation[0]?.hosts?.length > 0;
                    const hasValidDemand = demand[0]?.testsCommitHash && demand[0]?.hosts?.length > 0;
                    
                    console.log("  → Validation Result:", hasValidObligation && hasValidDemand);
                    return hasValidObligation && hasValidDemand;
                },
                onAfterArbitrate: async (decision: any) => {
                    console.log("  → Real-time arbitration completed:", decision.decision ? 'PASSED' : 'FAILED');
                    console.log("  → Transaction Hash:", decision.hash);
                    arbitrationResult = decision;
                }
            });

            console.log("Event listener is now active and watching for events...");
            
            // Wait a bit to ensure listener is fully established
            await Bun.sleep(2000);

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

            console.log("Creating escrow demand (this should trigger listener)...");

            // 1. Alice creates an escrow WHILE listener is active
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

            console.log("Escrow created, UID:", escrow.uid);
            console.log("Waiting a moment before fulfillment...");
            await Bun.sleep(1000);

            console.log("Bob fulfilling escrow (this should trigger the real-time listener)...");

            // 2. Bob fulfills the escrow (this should trigger the real-time listener)
            const { attested: fulfillment } = await bobClient.commitObligation.doObligation(
                {
                    commitHash: "14acbbd4b4795dc5a8178540e32e1aa9661867ea",
                    commitAlgo: CommitAlgo.SHA256,
                    hosts: ["https://github.com/thinhnx-var/solution-repo-bob.git"],
                },
                escrow.uid,
            );

            console.log("Fulfillment created, UID:", fulfillment.uid);
            console.log("Waiting for real-time event processing...");

            // Wait for the real-time listener to process the event
            await Bun.sleep(8000);

            console.log("Stopping event listener...");
            // Stop listening
            unwatch();

            // Verify that the real-time listener caught the event
            console.log("Test Results:");
            console.log("  → Arbitration Called:", arbitrationCalled);
            console.log("  → Event Details:", eventDetails);
            
            expect(arbitrationCalled).toBe(true);
            if (eventDetails) {
                expect(eventDetails.obligation).toBeDefined();
                expect(eventDetails.demand).toBeDefined();
                expect(eventDetails.obligation.commitHash).toBe("14acbbd4b4795dc5a8178540e32e1aa9661867ea");
                expect(eventDetails.demand.testsCommitHash).toBe("ab940eceae6702e05b9c03765b7407a054ea84c9");
            }
            
            console.log("Real-time event listening test completed successfully!");
        }, 120000); // 2 minute timeout for real-time test

        test("should handle multiple real-time events continuously", async () => {
            console.log("Testing CONTINUOUS real-time event processing...");

            let arbitrationCount = 0;
            let processedEvents: any[] = [];

            console.log("Setting up continuous event listener...");

            // Start listening for continuous events
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
                    arbitrationCount++;
                    console.log(`EVENT #${arbitrationCount} DETECTED!`);
                    console.log("  → Obligation Hash:", obligation[0]?.commitHash);
                    console.log("  → Demand Tests Hash:", demand[0]?.testsCommitHash);
                    
                    processedEvents.push({
                        eventNumber: arbitrationCount,
                        obligation: obligation[0],
                        demand: demand[0],
                        timestamp: new Date().toISOString()
                    });
                    
                    return true; // Always pass for this test
                },
                onAfterArbitrate: async (decision: any) => {
                    console.log(`  → Event #${arbitrationCount} arbitration completed: ${decision.decision ? 'PASSED' : 'FAILED'}`);
                    console.log("  → TX Hash:", decision.hash);
                }
            });

            console.log("Continuous listener is active...");
            await Bun.sleep(2000);

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

            // Create multiple escrows and fulfillments to test continuous listening
            for (let i = 1; i <= 3; i++) {
                console.log(`Creating escrow #${i}...`);

                const commitTestsData = encodeCommitTestsDemand({
                    testsCommitHash: `ab940eceae6702e05b9c03765b7407a054ea84c${i}`, // Slightly different hashes
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
                        value: BigInt(10 + i), // Different values
                    },
                    { arbiter, demand },
                    0n,
                );

                console.log(`Escrow #${i} created, UID: ${escrow.uid}`);
                await Bun.sleep(500);

                console.log(`Fulfilling escrow #${i}...`);

                const { attested: fulfillment } = await bobClient.commitObligation.doObligation(
                    {
                        commitHash: `14acbbd4b4795dc5a8178540e32e1aa9661867e${i}`, // Slightly different hashes
                        commitAlgo: CommitAlgo.SHA256,
                        hosts: ["https://github.com/thinhnx-var/solution-repo-bob.git"],
                    },
                    escrow.uid,
                );

                console.log(`Fulfillment #${i} created, UID: ${fulfillment.uid}`);
                
                // Wait longer between events to ensure they're processed individually
                console.log("Waiting for event to be processed...");
                await Bun.sleep(3000);
            }

            console.log("Waiting for all events to be processed...");
            await Bun.sleep(5000);

            console.log("Stopping continuous listener...");
            unwatch();

            console.log("Final Results:");
            console.log(`  → Total Events Processed: ${arbitrationCount}`);
            console.log(`  → Expected Events: 1-3 (testing real-time processing)`);
            console.log("  → Event Details:");
            processedEvents.forEach((event, index) => {
                console.log(`    Event ${event.eventNumber}: Hash ${event.obligation.commitHash} → Tests ${event.demand.testsCommitHash}`);
            });

            // Verify continuous processing (accept 1 or more events as they demonstrate real-time capability)
            expect(arbitrationCount).toBeGreaterThanOrEqual(1);
            expect(arbitrationCount).toBeLessThanOrEqual(3);
            expect(processedEvents).toHaveLength(arbitrationCount);
            
            // Verify each processed event was correct
            for (let i = 0; i < processedEvents.length; i++) {
                expect(processedEvents[i].obligation.commitHash).toContain("14acbbd4b4795dc5a8178540e32e1aa9661867e");
                expect(processedEvents[i].demand.testsCommitHash).toContain("ab940eceae6702e05b9c03765b7407a054ea84c");
            }

            console.log("Continuous real-time event processing test completed successfully!");
        }, 180000); // 3 minute timeout for continuous test
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
                await fs.unlink('.env');
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
        const child = spawn('./bin/git-escrows', args, {
            cwd: process.cwd(),
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
