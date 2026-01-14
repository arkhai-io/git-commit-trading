import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import type { TestContext } from "alkahest-ts/sdks/ts/tests/utils/setup";
import { exec } from "child_process";
import path from "path";
import { promisify } from "util";
import {
	encodeAbiParameters,
	parseAbiParameters,
} from "viem";
import {
	CommitAlgo,
} from "../../src/clients/commitObligation";
import { KeyType } from "../../src/clients/gitIdentityRegistry";
import {
	extractSSHKeyMaterial,
	generateSigningMessage,
	generateSSHSignature,
} from "../../src/crypto/index";
import { runTests } from "../../src/test-execution/index";
import { setupTest } from "../utils/setup";

const execAsync = promisify(exec);
const EXAMPLES_DIR = path.resolve(__dirname, "../../examples");

/**
 * Full Flow Integration Test
 *
 * Tests the complete escrow lifecycle using local examples:
 * 1. Alice creates escrow demand (buyer)
 * 2. Bob submits fulfillment (seller)
 * 3. Bob requests arbitration
 * 4. Oracle arbitrates using local test execution
 * 5. Bob collects escrow
 */
describe("Full Escrow Flow Integration", () => {
	// Test context and variables
	let testContext: TestContext;
	let alice: `0x${string}`;
	let bob: `0x${string}`;
	let oracle: `0x${string}`;
	let aliceClient: any;
	let bobClient: any;
	let oracleClient: any;
	let commitObligationAddress: `0x${string}`;
	let gitIdentityRegistryAddress: `0x${string}`;
	let containerAvailable = false;

	beforeAll(async () => {
		// Check for docker or podman
		for (const runtime of ["docker", "podman"]) {
			try {
				await execAsync(`${runtime} --version`);
				containerAvailable = true;
				console.log(`Using container runtime: ${runtime}`);
				break;
			} catch {
				// Continue to next runtime
			}
		}
		if (!containerAvailable) {
			console.log("⚠️ No container runtime (docker/podman) available, skipping integration tests");
			return;
		}

		// Set up blockchain environment
		const setup = await setupTest();
		testContext = setup.testContext;
		aliceClient = setup.aliceClient;
		bobClient = setup.bobClient;
		oracleClient = setup.charlieClient;

		alice = testContext.alice.address;
		bob = testContext.bob.address;
		oracle = testContext.charlie.address;
		commitObligationAddress = setup.commitObligationAddress;
		gitIdentityRegistryAddress = setup.gitIdentityRegistryAddress;
	});

	beforeEach(async () => {
		if (!containerAvailable) return;
		// Reset to initial state before each test
		if (testContext.anvilInitState) {
			await testContext.testClient.loadState({
				state: testContext.anvilInitState,
			});
		}
	});

	afterAll(async () => {
		if (testContext?.anvil) {
			await testContext.anvil.stop();
		}
	});

	// Helper to encode demand data
	const encodeCommitTestsDemand = (demand: {
		testsCommitHash: string;
		testsCommitAlgo: number;
		hosts: string[];
	}) => {
		return encodeAbiParameters(
			parseAbiParameters(
				"(string testsCommitHash, uint8 testsCommitAlgo, string[] hosts)",
			),
			[demand],
		);
	};

	// Helper to register a git key for testing
	// In production, this would use real SSH/PGP keys with proper signatures
	const registerTestKey = async (
		client: any,
		userAddress: `0x${string}`,
		label: string,
	): Promise<void> => {
		// Use a test SSH public key
		const sshPublicKey =
			"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFHxJQmkJz8of2SAQWSDaRiPXUzpoJ7NSsEFqBl0NZPy test@example.com";
		const keyMaterial = extractSSHKeyMaterial(sshPublicKey);
		const nonce = `nonce_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
		const nonceHash = Buffer.from(nonce).toString("hex").padStart(64, "0");

		// Try to load private key and generate real signature, otherwise use mock hex
		const privateKeyPath = process.env.HOME + "/.ssh/git-alkahest/id_ed25519";
		let signature: string;

		try {
			const fs = await import("fs");
			const privateKeyPEM = fs.readFileSync(privateKeyPath, "utf8");
			const signingMessage = generateSigningMessage(userAddress, nonce);
			signature = generateSSHSignature(privateKeyPEM, signingMessage);
		} catch {
			// Use mock hex signature for testing (won't cryptographically verify but demonstrates the flow)
			// Must be valid hex string
			signature = "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
		}

		try {
			const result = await client.gitIdentityRegistry.claimKey({
				keyType: KeyType.SSHEd25519,
				nonceHash: `0x${nonceHash}`,
				sig: `0x${signature}`,
				publicKey: keyMaterial,
			});
			console.log(`🔑 ${label}'s key registered: ${result.hash.slice(0, 18)}...`);
		} catch (error: any) {
			// Key might already be registered from previous test
			console.log(`🔑 ${label}'s key registration: ${error.message?.slice(0, 50) || "skipped"}`);
		}
	};

	test("Full flow: bun-test framework with key registration (local examples)", async () => {
		if (!containerAvailable) {
			console.log("Skipping: No container runtime available");
			return;
		}

		const testsDir = path.join(EXAMPLES_DIR, "bun-test/demand");
		const sourceDir = path.join(EXAMPLES_DIR, "bun-test/fulfillment");

		console.log("\n📋 Step 1: Alice registers her git key (buyer)");
		await registerTestKey(aliceClient, alice, "Alice");

		console.log("\n📋 Step 2: Bob registers his git key (seller)");
		await registerTestKey(bobClient, bob, "Bob");

		console.log("\n📋 Step 3: Alice creates escrow demand");
		const arbiter = testContext.addresses.trustedOracleArbiter;

		// Encode the commit tests demand
		const commitTestsData = encodeCommitTestsDemand({
			testsCommitHash: "local-test-commit",
			testsCommitAlgo: CommitAlgo.SHA256,
			hosts: ["local://bun-test/demand"],
		});

		const demand = aliceClient.arbiters.general.trustedOracle.encodeDemand({
			oracle,
			data: commitTestsData,
		});

		const { attested: escrow } =
			await aliceClient.erc20.escrow.nonTierable.permitAndCreate(
				{
					address: testContext.mockAddresses.erc20A,
					value: 10n,
				},
				{ arbiter, demand },
				0n,
			);

		expect(escrow.uid).toBeTruthy();
		console.log(`✅ Escrow created: ${escrow.uid.slice(0, 18)}...`);

		console.log("\n📋 Step 4: Bob submits fulfillment");
		const { attested: fulfillment } =
			await bobClient.commitObligation.doObligation(
				{
					commitHash: "local-solution-commit",
					commitAlgo: CommitAlgo.SHA256,
					hosts: ["local://bun-test/fulfillment"],
				},
				escrow.uid,
			);

		expect(fulfillment.uid).toBeTruthy();
		console.log(`✅ Fulfillment submitted: ${fulfillment.uid.slice(0, 18)}...`);

		console.log("\n📋 Step 5: Bob requests arbitration");
		const requestHash = await bobClient.arbiters.general.trustedOracle.requestArbitration(
			fulfillment.uid,
			oracle,
			demand,
		);

		// Wait for arbitration request to be confirmed
		await testContext.testClient.waitForTransactionReceipt({ hash: requestHash });
		console.log(`✅ Arbitration requested: ${requestHash.slice(0, 18)}...`);

		console.log("\n📋 Step 6: Oracle arbitrates with key verification");
		const { decisions } = await oracleClient.arbiters.general.trustedOracle.arbitrateMany(
			async ({ attestation }: { attestation: any }) => {
				// Verify Bob's registered key exists
				console.log("🔍 Verifying seller's registered key...");
				try {
					const bobKeyClaim = await oracleClient.gitIdentityRegistry.getLatestKeyClaim(bob);
					if (bobKeyClaim && bobKeyClaim.publicKey) {
						console.log(`✅ Found registered key for seller (type: ${bobKeyClaim.keyType})`);
					} else {
						console.log("❌ No registered key found for seller");
						return false;
					}
				} catch (error) {
					console.log(`❌ Failed to retrieve seller's key: ${error}`);
					return false;
				}

				// Run tests
				console.log("🔧 Running local test execution...");
				try {
					const result = await runTests(testsDir, sourceDir, {
						timeout: 120000,
					});

					console.log(`   Framework: ${result.frameworkUsed}`);
					console.log(`   Duration: ${result.duration}ms`);
					console.log(`   Success: ${result.success}`);

					return result.success;
				} catch (error) {
					console.error("❌ Test execution failed:", error);
					return false;
				}
			},
			{ mode: "past" },
		);

		expect(decisions.length).toBeGreaterThan(0);
		const lastDecision = decisions[decisions.length - 1];
		expect(lastDecision.decision).toBe(true);
		console.log(`✅ Arbitration complete: APPROVED`);

		console.log("\n📋 Step 7: Bob collects escrow");
		const collectionHash = await bobClient.erc20.escrow.nonTierable.collect(
			escrow.uid,
			fulfillment.uid,
		);

		expect(collectionHash).toBeTruthy();
		console.log(`✅ Escrow collected! Tx: ${collectionHash.slice(0, 18)}...`);

		console.log("\n🎉 Full flow with key verification completed successfully!");
	}, 300000); // 5 minute timeout

	test("Full flow: cargo framework (local examples)", async () => {
		if (!containerAvailable) {
			console.log("Skipping: No container runtime available");
			return;
		}

		const testsDir = path.join(EXAMPLES_DIR, "cargo/demand");
		const sourceDir = path.join(EXAMPLES_DIR, "cargo/fulfillment");

		console.log("\n📋 Step 1: Alice creates escrow demand");
		const arbiter = testContext.addresses.trustedOracleArbiter;

		const commitTestsData = encodeCommitTestsDemand({
			testsCommitHash: "local-rust-test-commit",
			testsCommitAlgo: CommitAlgo.SHA256,
			hosts: ["local://cargo/demand"],
		});

		const demand = aliceClient.arbiters.general.trustedOracle.encodeDemand({
			oracle,
			data: commitTestsData,
		});

		const { attested: escrow } =
			await aliceClient.erc20.escrow.nonTierable.permitAndCreate(
				{
					address: testContext.mockAddresses.erc20A,
					value: 10n,
				},
				{ arbiter, demand },
				0n,
			);

		expect(escrow.uid).toBeTruthy();
		console.log(`✅ Escrow created: ${escrow.uid.slice(0, 18)}...`);

		console.log("\n📋 Step 2: Bob submits fulfillment");
		const { attested: fulfillment } =
			await bobClient.commitObligation.doObligation(
				{
					commitHash: "local-rust-solution-commit",
					commitAlgo: CommitAlgo.SHA256,
					hosts: ["local://cargo/fulfillment"],
				},
				escrow.uid,
			);

		expect(fulfillment.uid).toBeTruthy();
		console.log(`✅ Fulfillment submitted: ${fulfillment.uid.slice(0, 18)}...`);

		console.log("\n📋 Step 3: Bob requests arbitration");
		const requestHash = await bobClient.arbiters.general.trustedOracle.requestArbitration(
			fulfillment.uid,
			oracle,
			demand,
		);

		await testContext.testClient.waitForTransactionReceipt({ hash: requestHash });
		console.log(`✅ Arbitration requested: ${requestHash.slice(0, 18)}...`);

		console.log("\n📋 Step 4: Oracle arbitrates using local test execution");
		const { decisions } = await oracleClient.arbiters.general.trustedOracle.arbitrateMany(
			async ({ attestation }: { attestation: any }) => {
				console.log("🔧 Running local Rust test execution...");
				try {
					const result = await runTests(testsDir, sourceDir, {
						timeout: 180000, // 3 minutes for Rust compilation
					});

					console.log(`   Framework: ${result.frameworkUsed}`);
					console.log(`   Duration: ${result.duration}ms`);
					console.log(`   Success: ${result.success}`);

					return result.success;
				} catch (error) {
					console.error("❌ Test execution failed:", error);
					return false;
				}
			},
			{ mode: "past" },
		);

		expect(decisions.length).toBeGreaterThan(0);
		const lastDecision = decisions[decisions.length - 1];
		expect(lastDecision.decision).toBe(true);
		console.log(`✅ Arbitration complete: APPROVED`);

		console.log("\n📋 Step 5: Bob collects escrow");
		const collectionHash = await bobClient.erc20.escrow.nonTierable.collect(
			escrow.uid,
			fulfillment.uid,
		);

		expect(collectionHash).toBeTruthy();
		console.log(`✅ Escrow collected! Tx: ${collectionHash.slice(0, 18)}...`);

		console.log("\n🎉 Full Rust flow completed successfully!");
	}, 360000); // 6 minute timeout

	test("Full flow: pytest-uv framework (local examples)", async () => {
		if (!containerAvailable) {
			console.log("Skipping: No container runtime available");
			return;
		}

		const testsDir = path.join(EXAMPLES_DIR, "pytest-uv/demand");
		const sourceDir = path.join(EXAMPLES_DIR, "pytest-uv/fulfillment");

		console.log("\n📋 Step 1: Alice creates escrow demand");
		const arbiter = testContext.addresses.trustedOracleArbiter;

		const commitTestsData = encodeCommitTestsDemand({
			testsCommitHash: "local-python-test-commit",
			testsCommitAlgo: CommitAlgo.SHA256,
			hosts: ["local://pytest-uv/demand"],
		});

		const demand = aliceClient.arbiters.general.trustedOracle.encodeDemand({
			oracle,
			data: commitTestsData,
		});

		const { attested: escrow } =
			await aliceClient.erc20.escrow.nonTierable.permitAndCreate(
				{
					address: testContext.mockAddresses.erc20A,
					value: 10n,
				},
				{ arbiter, demand },
				0n,
			);

		expect(escrow.uid).toBeTruthy();
		console.log(`✅ Escrow created: ${escrow.uid.slice(0, 18)}...`);

		console.log("\n📋 Step 2: Bob submits fulfillment");
		const { attested: fulfillment } =
			await bobClient.commitObligation.doObligation(
				{
					commitHash: "local-python-solution-commit",
					commitAlgo: CommitAlgo.SHA256,
					hosts: ["local://pytest-uv/fulfillment"],
				},
				escrow.uid,
			);

		expect(fulfillment.uid).toBeTruthy();
		console.log(`✅ Fulfillment submitted: ${fulfillment.uid.slice(0, 18)}...`);

		console.log("\n📋 Step 3: Bob requests arbitration");
		const requestHash = await bobClient.arbiters.general.trustedOracle.requestArbitration(
			fulfillment.uid,
			oracle,
			demand,
		);

		await testContext.testClient.waitForTransactionReceipt({ hash: requestHash });
		console.log(`✅ Arbitration requested: ${requestHash.slice(0, 18)}...`);

		console.log("\n📋 Step 4: Oracle arbitrates using local test execution");
		const { decisions } = await oracleClient.arbiters.general.trustedOracle.arbitrateMany(
			async ({ attestation }: { attestation: any }) => {
				console.log("🔧 Running local Python test execution...");
				try {
					const result = await runTests(testsDir, sourceDir, {
						timeout: 180000,
					});

					console.log(`   Framework: ${result.frameworkUsed}`);
					console.log(`   Duration: ${result.duration}ms`);
					console.log(`   Success: ${result.success}`);

					return result.success;
				} catch (error) {
					console.error("❌ Test execution failed:", error);
					return false;
				}
			},
			{ mode: "past" },
		);

		expect(decisions.length).toBeGreaterThan(0);
		const lastDecision = decisions[decisions.length - 1];
		expect(lastDecision.decision).toBe(true);
		console.log(`✅ Arbitration complete: APPROVED`);

		console.log("\n📋 Step 5: Bob collects escrow");
		const collectionHash = await bobClient.erc20.escrow.nonTierable.collect(
			escrow.uid,
			fulfillment.uid,
		);

		expect(collectionHash).toBeTruthy();
		console.log(`✅ Escrow collected! Tx: ${collectionHash.slice(0, 18)}...`);

		console.log("\n🎉 Full Python flow completed successfully!");
	}, 300000); // 5 minute timeout

	test("Full flow: custom dockerfile (local examples)", async () => {
		if (!containerAvailable) {
			console.log("Skipping: No container runtime available");
			return;
		}

		const testsDir = path.join(EXAMPLES_DIR, "custom-dockerfile/demand");
		const sourceDir = path.join(EXAMPLES_DIR, "custom-dockerfile/fulfillment");

		console.log("\n📋 Step 1: Alice creates escrow demand");
		const arbiter = testContext.addresses.trustedOracleArbiter;

		const commitTestsData = encodeCommitTestsDemand({
			testsCommitHash: "local-custom-test-commit",
			testsCommitAlgo: CommitAlgo.SHA256,
			hosts: ["local://custom-dockerfile/demand"],
		});

		const demand = aliceClient.arbiters.general.trustedOracle.encodeDemand({
			oracle,
			data: commitTestsData,
		});

		const { attested: escrow } =
			await aliceClient.erc20.escrow.nonTierable.permitAndCreate(
				{
					address: testContext.mockAddresses.erc20A,
					value: 10n,
				},
				{ arbiter, demand },
				0n,
			);

		expect(escrow.uid).toBeTruthy();
		console.log(`✅ Escrow created: ${escrow.uid.slice(0, 18)}...`);

		console.log("\n📋 Step 2: Bob submits fulfillment");
		const { attested: fulfillment } =
			await bobClient.commitObligation.doObligation(
				{
					commitHash: "local-custom-solution-commit",
					commitAlgo: CommitAlgo.SHA256,
					hosts: ["local://custom-dockerfile/fulfillment"],
				},
				escrow.uid,
			);

		expect(fulfillment.uid).toBeTruthy();
		console.log(`✅ Fulfillment submitted: ${fulfillment.uid.slice(0, 18)}...`);

		console.log("\n📋 Step 3: Bob requests arbitration");
		const requestHash = await bobClient.arbiters.general.trustedOracle.requestArbitration(
			fulfillment.uid,
			oracle,
			demand,
		);

		await testContext.testClient.waitForTransactionReceipt({ hash: requestHash });
		console.log(`✅ Arbitration requested: ${requestHash.slice(0, 18)}...`);

		console.log("\n📋 Step 4: Oracle arbitrates using local test execution");
		const { decisions } = await oracleClient.arbiters.general.trustedOracle.arbitrateMany(
			async ({ attestation }: { attestation: any }) => {
				console.log("🔧 Running local custom dockerfile test execution...");
				try {
					const result = await runTests(testsDir, sourceDir, {
						timeout: 120000,
					});

					console.log(`   Framework: ${result.frameworkUsed}`);
					console.log(`   Duration: ${result.duration}ms`);
					console.log(`   Success: ${result.success}`);

					return result.success;
				} catch (error) {
					console.error("❌ Test execution failed:", error);
					return false;
				}
			},
			{ mode: "past" },
		);

		expect(decisions.length).toBeGreaterThan(0);
		const lastDecision = decisions[decisions.length - 1];
		expect(lastDecision.decision).toBe(true);
		console.log(`✅ Arbitration complete: APPROVED`);

		console.log("\n📋 Step 5: Bob collects escrow");
		const collectionHash = await bobClient.erc20.escrow.nonTierable.collect(
			escrow.uid,
			fulfillment.uid,
		);

		expect(collectionHash).toBeTruthy();
		console.log(`✅ Escrow collected! Tx: ${collectionHash.slice(0, 18)}...`);

		console.log("\n🎉 Full custom dockerfile flow completed successfully!");
	}, 300000); // 5 minute timeout
});
