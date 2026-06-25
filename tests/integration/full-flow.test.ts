/**
 * Full Flow Integration Test
 *
 * Tests the complete escrow lifecycle with cryptographic verification.
 *
 * ============================================================================
 * SETUP INSTRUCTIONS
 * ============================================================================
 *
 * 1. Generate an SSH key pair for testing (if you don't have one):
 *
 *    mkdir -p ~/.ssh/git-alkahest
 *    ssh-keygen -t ed25519 -f ~/.ssh/git-alkahest/id_ed25519 -N "" -C "test@example.com"
 *
 * 2. Create a .env.test file in the project root with:
 *
 *    # Path to your SSH private key (ed25519 format)
 *    TEST_SSH_PRIVATE_KEY_PATH=~/.ssh/git-alkahest/id_ed25519
 *
 *    # Path to your SSH public key
 *    TEST_SSH_PUBLIC_KEY_PATH=~/.ssh/git-alkahest/id_ed25519.pub
 *
 * 3. Run the tests:
 *
 *    bun test tests/integration/full-flow.test.ts
 *
 * ============================================================================
 * WHAT THIS TEST VERIFIES
 * ============================================================================
 *
 * 1. Alice (buyer) and Bob (seller) register their SSH keys on-chain
 * 2. Alice creates an escrow demand with test specifications
 * 3. Bob submits a fulfillment attestation
 * 4. Bob requests arbitration from the oracle
 * 5. Oracle verifies Bob's registered key and runs tests
 * 6. Oracle submits arbitration decision (pass/fail based on test execution)
 * 7. Bob collects escrow funds on successful arbitration
 *
 * All cryptographic signatures are verified.
 */

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import type { TestContext } from "alkahest-ts/test-utils";
import type { AttestationWithDemand } from "alkahest-ts";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { CommitAlgo } from "../../src/clients/commitObligation";
import {
	type GitKeyClaim,
	KeyType,
	createGitKeyClaim,
} from "../../src/clients/gitIdentityRegistry";
import {
	generateSigningMessage,
	generateSSHSignature,
	getRegisteredKey,
} from "../../src/crypto/index";
import { runTests } from "../../src/test-execution/index";
import { type ExtendedClient, setupTest } from "../utils/setup";

const execAsync = promisify(exec);
const EXAMPLES_DIR = path.resolve(__dirname, "../../examples");

// Load environment variables from .env.test if it exists
function loadTestEnv(): { privateKeyPath: string; publicKeyPath: string } | null {
	const envTestPath = path.resolve(__dirname, "../../.env.test");

	// Try .env.test first, then fall back to common locations
	let privateKeyPath: string | undefined;
	let publicKeyPath: string | undefined;

	if (fs.existsSync(envTestPath)) {
		const content = fs.readFileSync(envTestPath, "utf8");
		const lines = content.split("\n");
		for (const line of lines) {
			const [key, ...valueParts] = line.split("=");
			const value = valueParts.join("=").trim();
			if (key?.trim() === "TEST_SSH_PRIVATE_KEY_PATH") {
				privateKeyPath = value.replace(/^~/, process.env.HOME || "");
			}
			if (key?.trim() === "TEST_SSH_PUBLIC_KEY_PATH") {
				publicKeyPath = value.replace(/^~/, process.env.HOME || "");
			}
		}
	}

	// Fall back to default location if not specified
	if (!privateKeyPath) {
		const defaultPath = `${process.env.HOME}/.ssh/git-alkahest/id_ed25519`;
		if (fs.existsSync(defaultPath)) {
			privateKeyPath = defaultPath;
			publicKeyPath = `${defaultPath}.pub`;
		}
	}

	if (!privateKeyPath || !publicKeyPath) {
		return null;
	}

	// Verify files exist
	if (!fs.existsSync(privateKeyPath)) {
		console.error(`SSH private key not found at: ${privateKeyPath}`);
		return null;
	}
	if (!fs.existsSync(publicKeyPath)) {
		console.error(`SSH public key not found at: ${publicKeyPath}`);
		return null;
	}

	return { privateKeyPath, publicKeyPath };
}

// Parse SSH public key to extract the key material and comment
function parseSSHPublicKey(publicKeyPath: string): {
	keyType: string;
	keyMaterial: string;
	comment: string;
} {
	const content = fs.readFileSync(publicKeyPath, "utf8").trim();
	const parts = content.split(" ");
	if (parts.length < 2) {
		throw new Error("Invalid SSH public key format");
	}
	return {
		keyType: parts[0] || "",
		keyMaterial: parts[1] || "",
		comment: parts.slice(2).join(" ") || "",
	};
}

describe("Full Escrow Flow Integration", () => {
	// Test context and variables with proper types
	let testContext: TestContext;
	let alice: `0x${string}`;
	let bob: `0x${string}`;
	let oracle: `0x${string}`;
	let aliceClient: ExtendedClient;
	let bobClient: ExtendedClient;
	let oracleClient: ExtendedClient;
	let gitIdentityRegistryAddress: `0x${string}`;
	let containerAvailable = false;
	let sshKeysAvailable = false;
	let sshPrivateKeyPath: string;
	let sshPublicKey: { keyType: string; keyMaterial: string; comment: string };

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
			console.log(
				"⚠️ No container runtime (docker/podman) available, skipping integration tests",
			);
			return;
		}

		// Check for SSH keys
		const testEnv = loadTestEnv();
		if (!testEnv) {
			console.log(
				"⚠️ SSH keys not configured. See test file header for setup instructions.",
			);
			console.log("   Expected: ~/.ssh/git-alkahest/id_ed25519 (ed25519 key)");
			console.log("   Or create .env.test with TEST_SSH_PRIVATE_KEY_PATH");
			return;
		}

		sshPrivateKeyPath = testEnv.privateKeyPath;
		sshPublicKey = parseSSHPublicKey(testEnv.publicKeyPath);

		// Verify it's an ed25519 key (required for this test)
		if (!sshPublicKey.keyType.includes("ed25519")) {
			console.log(
				`⚠️ SSH key must be ed25519, got: ${sshPublicKey.keyType}`,
			);
			return;
		}

		sshKeysAvailable = true;
		console.log(
			`Using SSH key: ${testEnv.publicKeyPath} (${sshPublicKey.comment || "no comment"})`,
		);

		// Set up blockchain environment
		const setup = await setupTest();
		testContext = setup.testContext;
		aliceClient = setup.aliceClient;
		bobClient = setup.bobClient;
		oracleClient = setup.charlieClient;

		alice = testContext.alice.address;
		bob = testContext.bob.address;
		oracle = testContext.charlie.address;
		gitIdentityRegistryAddress = setup.gitIdentityRegistryAddress;
	});

	beforeEach(async () => {
		if (!containerAvailable || !sshKeysAvailable) return;
		// Reset to initial state before each test
		if (testContext?.anvilInitState) {
			await testContext.testClient.loadState({
				state: testContext.anvilInitState,
			});
		}
	});

	afterAll(async () => {
		// Don't explicitly stop anvil - it causes timeout issues and will be
		// cleaned up automatically when the process exits
	});

	// Helper to encode demand data
	const encodeCommitTestsDemand = (demand: {
		testsCommitHash: string;
		testsCommitAlgo: number;
		hosts: string[];
	}): `0x${string}` => {
		return encodeAbiParameters(
			parseAbiParameters(
				"(string testsCommitHash, uint8 testsCommitAlgo, string[] hosts)",
			),
			[demand],
		);
	};

	// Register a git key with cryptographic signatures
	const registerGitKey = async (
		client: ExtendedClient,
		userAddress: `0x${string}`,
		label: string,
	): Promise<GitKeyClaim> => {
		// Generate a unique nonce and hash it
		// The nonce itself is kept secret; only the hash is stored on-chain
		const nonce = `nonce_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
		const crypto = await import("crypto");
		const nonceHash = crypto.createHash("sha256").update(nonce, "utf8").digest("hex");

		// Create the signing message using the nonceHash (what the verifier will use)
		// This ensures the signature can be verified using only on-chain data
		const signingMessage = generateSigningMessage(userAddress, nonceHash);
		console.log(`  Signing message: "${signingMessage}"`);

		// Generate REAL SSH signature using the private key
		const privateKeyPEM = fs.readFileSync(sshPrivateKeyPath, "utf8");
		const signature = generateSSHSignature(privateKeyPEM, signingMessage);
		console.log(`  Generated signature: ${signature.slice(0, 32)}...`);

		// Create the key claim with proper types
		const keyClaim = createGitKeyClaim(
			KeyType.SSHEd25519,
			nonceHash,
			signature,
			sshPublicKey.keyMaterial,
		);

		// Submit the key claim on-chain
		const result = await client.gitIdentityRegistry.claimKey(keyClaim);
		console.log(`🔑 ${label}'s key registered: ${result.hash.slice(0, 18)}...`);

		// Wait for transaction confirmation
		await testContext.testClient.waitForTransactionReceipt({ hash: result.hash });

		return keyClaim;
	};


	test("Full flow: bun-test framework", async () => {
		if (!containerAvailable) {
			console.log("Skipping: No container runtime available");
			return;
		}
		if (!sshKeysAvailable) {
			console.log("Skipping: SSH keys not configured");
			return;
		}

		const testsDir = path.join(EXAMPLES_DIR, "bun-test/demand");
		const sourceDir = path.join(EXAMPLES_DIR, "bun-test/fulfillment");

		console.log("\n📋 Step 1: Alice registers her git key (buyer)");
		const aliceKeyClaim = await registerGitKey(aliceClient, alice, "Alice");

		console.log("\n📋 Step 2: Bob registers his git key (seller)");
		const bobKeyClaim = await registerGitKey(bobClient, bob, "Bob");

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
			await aliceClient.erc20.escrow.default.permitAndCreate(
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
		const requestHash =
			await bobClient.arbiters.general.trustedOracle.requestArbitration(
				fulfillment.uid,
				oracle,
				demand,
			);

		// Wait for arbitration request to be confirmed
		await testContext.testClient.waitForTransactionReceipt({
			hash: requestHash,
		});
		console.log(`✅ Arbitration requested: ${requestHash.slice(0, 18)}...`);

		console.log("\n📋 Step 6: Oracle arbitrates with key verification");
		const { decisions } =
			await oracleClient.arbiters.general.trustedOracle.arbitrateMany(
				async ({ attestation }: AttestationWithDemand): Promise<boolean | null> => {
					// Verify Bob's registered key exists and is cryptographically valid
					// getRegisteredKey returns null if key doesn't exist or signature is invalid
					console.log("🔍 Verifying Bob's registered key...");
					const bobKey = await getRegisteredKey(
						testContext.testClient,
						gitIdentityRegistryAddress,
						bob,
					);
					expect(bobKey).not.toBeNull();
					console.log(`✅ Bob's key verified: ${KeyType[bobKey!.keyType]}`);

					// Run tests
					console.log("🔧 Running local test execution...");
					const result = await runTests(testsDir, sourceDir, {
						timeout: 120000,
					});

					console.log(`   Framework: ${result.frameworkUsed}`);
					console.log(`   Duration: ${result.duration}ms`);
					console.log(`   Success: ${result.success}`);
					expect(result.success).toBe(true);

					return result.success;
				},
				{ mode: "past" },
			);

		expect(decisions.length).toBeGreaterThan(0);
		const lastDecision = decisions[decisions.length - 1];
		expect(lastDecision).toBeDefined();
		expect(lastDecision!.decision).toBe(true);
		console.log("✅ Arbitration complete: APPROVED");

		console.log("\n📋 Step 7: Bob collects escrow");
		const collectionHash = await bobClient.erc20.escrow.default.collect(
			escrow.uid,
			fulfillment.uid,
		);

		expect(collectionHash).toBeTruthy();
		console.log(`✅ Escrow collected! Tx: ${collectionHash.slice(0, 18)}...`);

		console.log("\n🎉 Full bun-test flow completed successfully!");
	}, 300000); // 5 minute timeout

	test("Full flow: cargo framework (local examples)", async () => {
		if (!containerAvailable) {
			console.log("Skipping: No container runtime available");
			return;
		}
		if (!sshKeysAvailable) {
			console.log("Skipping: SSH keys not configured");
			return;
		}

		const testsDir = path.join(EXAMPLES_DIR, "cargo/demand");
		const sourceDir = path.join(EXAMPLES_DIR, "cargo/fulfillment");

		console.log("\n📋 Step 1: Register keys for Alice and Bob");
		await registerGitKey(aliceClient, alice, "Alice");
		await registerGitKey(bobClient, bob, "Bob");

		console.log("\n📋 Step 2: Alice creates escrow demand");
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
			await aliceClient.erc20.escrow.default.permitAndCreate(
				{
					address: testContext.mockAddresses.erc20A,
					value: 10n,
				},
				{ arbiter, demand },
				0n,
			);

		expect(escrow.uid).toBeTruthy();
		console.log(`✅ Escrow created: ${escrow.uid.slice(0, 18)}...`);

		console.log("\n📋 Step 3: Bob submits fulfillment");
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

		console.log("\n📋 Step 4: Bob requests arbitration");
		const requestHash =
			await bobClient.arbiters.general.trustedOracle.requestArbitration(
				fulfillment.uid,
				oracle,
				demand,
			);

		await testContext.testClient.waitForTransactionReceipt({
			hash: requestHash,
		});
		console.log(`✅ Arbitration requested: ${requestHash.slice(0, 18)}...`);

		console.log("\n📋 Step 5: Oracle arbitrates using local test execution");
		const { decisions } =
			await oracleClient.arbiters.general.trustedOracle.arbitrateMany(
				async ({ attestation }: AttestationWithDemand): Promise<boolean | null> => {
					// Verify seller's key
					console.log("🔍 Verifying Bob's registered key...");
					const bobKey = await getRegisteredKey(
						testContext.testClient,
						gitIdentityRegistryAddress,
						bob,
					);
					expect(bobKey).not.toBeNull();
					console.log(`✅ Bob's key verified: ${KeyType[bobKey!.keyType]}`);

					console.log("🔧 Running local Rust test execution...");
					const result = await runTests(testsDir, sourceDir, {
						timeout: 180000, // 3 minutes for Rust compilation
					});

					console.log(`   Framework: ${result.frameworkUsed}`);
					console.log(`   Duration: ${result.duration}ms`);
					console.log(`   Success: ${result.success}`);
					expect(result.success).toBe(true);

					return result.success;
				},
				{ mode: "past" },
			);

		expect(decisions.length).toBeGreaterThan(0);
		const lastDecision = decisions[decisions.length - 1];
		expect(lastDecision).toBeDefined();
		expect(lastDecision!.decision).toBe(true);
		console.log("✅ Arbitration complete: APPROVED");

		console.log("\n📋 Step 6: Bob collects escrow");
		const collectionHash = await bobClient.erc20.escrow.default.collect(
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
		if (!sshKeysAvailable) {
			console.log("Skipping: SSH keys not configured");
			return;
		}

		const testsDir = path.join(EXAMPLES_DIR, "pytest-uv/demand");
		const sourceDir = path.join(EXAMPLES_DIR, "pytest-uv/fulfillment");

		console.log("\n📋 Step 1: Register keys for Alice and Bob");
		await registerGitKey(aliceClient, alice, "Alice");
		await registerGitKey(bobClient, bob, "Bob");

		console.log("\n📋 Step 2: Alice creates escrow demand");
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
			await aliceClient.erc20.escrow.default.permitAndCreate(
				{
					address: testContext.mockAddresses.erc20A,
					value: 10n,
				},
				{ arbiter, demand },
				0n,
			);

		expect(escrow.uid).toBeTruthy();
		console.log(`✅ Escrow created: ${escrow.uid.slice(0, 18)}...`);

		console.log("\n📋 Step 3: Bob submits fulfillment");
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

		console.log("\n📋 Step 4: Bob requests arbitration");
		const requestHash =
			await bobClient.arbiters.general.trustedOracle.requestArbitration(
				fulfillment.uid,
				oracle,
				demand,
			);

		await testContext.testClient.waitForTransactionReceipt({
			hash: requestHash,
		});
		console.log(`✅ Arbitration requested: ${requestHash.slice(0, 18)}...`);

		console.log("\n📋 Step 5: Oracle arbitrates using local test execution");
		const { decisions } =
			await oracleClient.arbiters.general.trustedOracle.arbitrateMany(
				async ({ attestation }: AttestationWithDemand): Promise<boolean | null> => {
					// Verify seller's key
					console.log("🔍 Verifying Bob's registered key...");
					const bobKey = await getRegisteredKey(
						testContext.testClient,
						gitIdentityRegistryAddress,
						bob,
					);
					expect(bobKey).not.toBeNull();
					console.log(`✅ Bob's key verified: ${KeyType[bobKey!.keyType]}`);

					console.log("🔧 Running local Python test execution...");
					const result = await runTests(testsDir, sourceDir, {
						timeout: 180000,
					});

					console.log(`   Framework: ${result.frameworkUsed}`);
					console.log(`   Duration: ${result.duration}ms`);
					console.log(`   Success: ${result.success}`);
					expect(result.success).toBe(true);

					return result.success;
				},
				{ mode: "past" },
			);

		expect(decisions.length).toBeGreaterThan(0);
		const lastDecision = decisions[decisions.length - 1];
		expect(lastDecision).toBeDefined();
		expect(lastDecision!.decision).toBe(true);
		console.log("✅ Arbitration complete: APPROVED");

		console.log("\n📋 Step 6: Bob collects escrow");
		const collectionHash = await bobClient.erc20.escrow.default.collect(
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
		if (!sshKeysAvailable) {
			console.log("Skipping: SSH keys not configured");
			return;
		}

		const testsDir = path.join(EXAMPLES_DIR, "custom-dockerfile/demand");
		const sourceDir = path.join(EXAMPLES_DIR, "custom-dockerfile/fulfillment");

		console.log("\n📋 Step 1: Register keys for Alice and Bob");
		await registerGitKey(aliceClient, alice, "Alice");
		await registerGitKey(bobClient, bob, "Bob");

		console.log("\n📋 Step 2: Alice creates escrow demand");
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
			await aliceClient.erc20.escrow.default.permitAndCreate(
				{
					address: testContext.mockAddresses.erc20A,
					value: 10n,
				},
				{ arbiter, demand },
				0n,
			);

		expect(escrow.uid).toBeTruthy();
		console.log(`✅ Escrow created: ${escrow.uid.slice(0, 18)}...`);

		console.log("\n📋 Step 3: Bob submits fulfillment");
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

		console.log("\n📋 Step 4: Bob requests arbitration");
		const requestHash =
			await bobClient.arbiters.general.trustedOracle.requestArbitration(
				fulfillment.uid,
				oracle,
				demand,
			);

		await testContext.testClient.waitForTransactionReceipt({
			hash: requestHash,
		});
		console.log(`✅ Arbitration requested: ${requestHash.slice(0, 18)}...`);

		console.log("\n📋 Step 5: Oracle arbitrates using local test execution");
		const { decisions } =
			await oracleClient.arbiters.general.trustedOracle.arbitrateMany(
				async ({ attestation }: AttestationWithDemand): Promise<boolean | null> => {
					// Verify seller's key
					console.log("🔍 Verifying Bob's registered key...");
					const bobKey = await getRegisteredKey(
						testContext.testClient,
						gitIdentityRegistryAddress,
						bob,
					);
					expect(bobKey).not.toBeNull();
					console.log(`✅ Bob's key verified: ${KeyType[bobKey!.keyType]}`);

					console.log("🔧 Running local custom dockerfile test execution...");
					const result = await runTests(testsDir, sourceDir, {
						timeout: 120000,
					});

					console.log(`   Framework: ${result.frameworkUsed}`);
					console.log(`   Duration: ${result.duration}ms`);
					console.log(`   Success: ${result.success}`);
					expect(result.success).toBe(true);

					return result.success;
				},
				{ mode: "past" },
			);

		expect(decisions.length).toBeGreaterThan(0);
		const lastDecision = decisions[decisions.length - 1];
		expect(lastDecision).toBeDefined();
		expect(lastDecision!.decision).toBe(true);
		console.log("✅ Arbitration complete: APPROVED");

		console.log("\n📋 Step 6: Bob collects escrow");
		const collectionHash = await bobClient.erc20.escrow.default.collect(
			escrow.uid,
			fulfillment.uid,
		);

		expect(collectionHash).toBeTruthy();
		console.log(`✅ Escrow collected! Tx: ${collectionHash.slice(0, 18)}...`);

		console.log("\n🎉 Full custom dockerfile flow completed successfully!");
	}, 300000); // 5 minute timeout
});
