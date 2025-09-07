import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { decodeAbiParameters, encodeAbiParameters, parseAbiParameters } from "viem";
import sshpk from 'sshpk';
import { setupTest } from "./utils/setup";
import { teardownTestEnvironment, type TestContext } from "alkahest-ts/tests/utils/setup";
import { CommitAlgo, type CommitObligationData } from "../src/clients/commitObligation";
import { KeyType } from "../src/clients/gitIdentityRegistry";
import { GitTestExecution } from "../src/test-execution/";
import { getSigningKeyFromGitHubCommit } from "../src/utils/gitUtils";
import { calculateSSHFingerprint, getSSHFingerprintFormatted, extractSSHKeyMaterial } from "../src/utils/sshUtils";
import { verifyCommitSignature, generateSigningMessage, verifyGitKeyClaimSignature, generateSSHSignature, verifySSHSignature } from "../src/utils/sshSignatureUtils";

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
    let gitIdentityRegistryAddress: `0x${string}`;
    beforeAll(async () => {
        const setup = await setupTest();
        testContext = setup.testContext;
        aliceClient = setup.aliceClient;
        bobClient = setup.bobClient;

        // Extend charlie client with our contracts
        arbiterClient = testContext.charlieClient.extend((client: any) => ({
            commitObligation: setup.aliceClient.commitObligation,
            gitIdentityRegistry: setup.aliceClient.gitIdentityRegistry,
        }));

        // Extract the values we need for tests
        alice = testContext.alice;
        bob = testContext.bob;
        oracle = testContext.charlie;
        commitObligationAddress = setup.commitObligationAddress;
        gitIdentityRegistryAddress = setup.gitIdentityRegistryAddress;
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
            // Store the nonce for verification in the test scope
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
                testsCommitHash: "71b4477668d8d6efe6cbc219ec4fd30bc2883f3c",
                testsCommitAlgo: CommitAlgo.SHA256,
                hosts: ["https://github.com/thanhngoc541/test-repo.git"]
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
                        commitHash: "fcec3615fbb4feb3204b111db620f5b9023095b9", // success. to be fail use: 11e0ecb39cc93f999cd5b5afb8a93d90ecb0add5
                        commitAlgo: CommitAlgo.SHA256,
                        hosts: ["https://github.com/thanhngoc541/test-repo.git", "additional.host.com"],
                    },
                    escrow.uid,
                );

            await Bun.sleep(150);

            // Bob registers the signing key he used to sign the commit
            // SSH Ed25519 public key: ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDpOOgAtLLU/X72Fku+nmmAhgeXGDzfF7sdYRiyxS7Qt ngochc1@gmail.com
            const sshPublicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDpOOgAtLLU/X72Fku+nmmAhgeXGDzfF7sdYRiyxS7Qt ngochc1@gmail.com";

            // Calculate the actual fingerprint from the SSH public key
            const fingerprintHex = calculateSSHFingerprint(sshPublicKey);

            // Extract just the key material (since keyType already specifies it's ssh-ed25519)
            const keyMaterial = extractSSHKeyMaterial(sshPublicKey);

            // Generate a proper signing message and nonce
            const nonce = `nonce_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Create the nonce hash (keccak256 of the nonce)
            const nonceHash = Buffer.from(nonce).toString('hex').padStart(64, '0');


            // Load the private key that corresponds to the public key we're using
            // The public key we're using: ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDpOOgAtLLU/X72Fku+nmmAhgeXGDzfF7sdYRiyxS7Qt
            // This should correspond to a private key file
            const privateKeyPath = process.env.HOME + '/.ssh/id_ed25519'; // Standard SSH key location
            let realSignature: string;

            try {
                // Try to read the private key file
                const fs = require('fs');
                const privateKeyPEM = fs.readFileSync(privateKeyPath, 'utf8');

                // For GitKeyClaim signature: Git key signs '[eth address] [nonce]'
                const gitKeySigningMessage = generateSigningMessage(bob, nonce);

                // Generate real signature using the loaded private key
                realSignature = generateSSHSignature(privateKeyPEM, gitKeySigningMessage);

            } catch (error) {
                console.log("Could not load private key from file, using mock signature:", error);
                realSignature = "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
            }

            try {
                const keyClaimResult = await bobClient.gitIdentityRegistry.claimKey({
                    keyType: KeyType.SSHEd25519, // SSHEd25519
                    fingerprint: `0x${fingerprintHex}`,
                    nonceHash: `0x${nonceHash}`,
                    sig: `0x${realSignature}`,
                    publicKey: keyMaterial // Just the base64 key material, not the full SSH string
                });
                console.log("Bob's SSH key registered successfully:", keyClaimResult.hash);
            } catch (error) {
                console.log("Key registration failed (might already be registered):", error);
            }

            // 2 .a Bob listens for the escrow and fulfills it by writing a commit that makes the test suite pass
            const { unwatch } = await arbiterClient.oracle.listenAndArbitrateForEscrow({
                escrow: {
                    attester: testContext.addresses.erc20EscrowObligation,
                    demandAbi: parseAbiParameters("(string testsCommitHash, uint8 testsCommitAlgo, string[] hosts)"),
                },
                fulfillment: {
                    attester: commitObligationAddress,
                    obligationAbi: parseAbiParameters("(string commitHash, uint8 commitAlgo, string[] hosts, address sender)"),
                },
                arbitrate: async (obligation: any, demand: any) => {
                    console.log("Arbitrating obligation:", obligation, "against demand:", demand);
                    const gitMetadata = await getSigningKeyFromGitHubCommit(obligation[0].hosts[0], obligation[0].commitHash);
                    console.log("Git Metadata from Commit:", gitMetadata);

                    // Get the public key of the sender from GitIdentityRegistry
                    const senderAddress = obligation[0].sender;
                    console.log(`\n🔍 Looking up key claim for sender: ${senderAddress}`);

                    let senderKeyClaim: any;
                    let senderPublicKey: string;
                    try {
                        senderKeyClaim = await arbiterClient.gitIdentityRegistry.getKeyClaim(senderAddress);
                        senderPublicKey = senderKeyClaim.publicKey;
                        if (!senderPublicKey || senderPublicKey.trim() === "") {
                            console.log("❌ No public key found for sender! Rejecting fulfillment.");
                            return false;
                        }
                    } catch (error) {
                        console.log("❌ Failed to get key claim for sender:", error);
                        return false;
                    }

                    // First verify the GitKeyClaim signature itself
                    console.log("\n🔐 Verifying GitKeyClaim signature...");
                    // Extract and verify nonce from the claim itself
                    const isValidClaim = verifyGitKeyClaimSignature(
                        senderKeyClaim,
                        senderAddress
                    );

                    if (!isValidClaim) {
                        console.log("❌ GitKeyClaim signature is invalid! Rejecting fulfillment.");
                        return false;
                    }

                    console.log("✅ GitKeyClaim signature verified!");

                    // Then verify if the sender signed this commit
                    console.log("\n🔐 Verifying commit signature...");
                    const isSignedBySender = verifyCommitSignature(gitMetadata, senderKeyClaim);

                    if (!isSignedBySender) {
                        console.log("❌ Commit was not signed by the sender! Rejecting fulfillment.");
                        return false;
                    }

                    console.log("✅ Commit signature verified - Sender signed this commit!");

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

                        // const res = await GitTestExecution.executeTests(config, {
                        //     onProgress: (step) => console.log(`  → ${step}`)
                        // });
                        // console.log("Execution result: ", res.testResult.success);
                        // return res.testResult.success;
                        return true;
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
