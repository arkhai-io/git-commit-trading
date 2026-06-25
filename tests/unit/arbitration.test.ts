/**
 * Unit Tests: Arbitration
 *
 * Tests the arbitration process with and without key verification.
 */

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { TestContext } from "alkahest-ts/test-utils";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { CommitAlgo } from "../../src/clients/commitObligation";
import {
	KeyType,
	createGitKeyClaim,
} from "../../src/clients/gitIdentityRegistry";
import {
	generateSigningMessage,
	generateSSHSignature,
	getRegisteredKey,
} from "../../src/crypto/index";
import { type ExtendedClient, setupTest } from "../utils/setup";

// Load SSH key paths
function loadSSHKeyPaths(): { privateKeyPath: string; publicKeyPath: string } | null {
	const envTestPath = path.resolve(__dirname, "../../.env.test");
	let privateKeyPath: string | undefined;
	let publicKeyPath: string | undefined;

	if (fs.existsSync(envTestPath)) {
		const content = fs.readFileSync(envTestPath, "utf8");
		for (const line of content.split("\n")) {
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

	if (!privateKeyPath) {
		const defaultPath = `${process.env.HOME}/.ssh/git-alkahest/id_ed25519`;
		if (fs.existsSync(defaultPath)) {
			privateKeyPath = defaultPath;
			publicKeyPath = `${defaultPath}.pub`;
		}
	}

	if (!privateKeyPath || !publicKeyPath) return null;
	if (!fs.existsSync(privateKeyPath) || !fs.existsSync(publicKeyPath)) return null;

	return { privateKeyPath, publicKeyPath };
}

function parseSSHPublicKey(publicKeyPath: string): {
	keyType: string;
	keyMaterial: string;
} {
	const content = fs.readFileSync(publicKeyPath, "utf8").trim();
	const parts = content.split(" ");
	return { keyType: parts[0] || "", keyMaterial: parts[1] || "" };
}

describe("Arbitration", () => {
	let testContext: TestContext;
	let alice: `0x${string}`;
	let bob: `0x${string}`;
	let oracle: `0x${string}`;
	let aliceClient: ExtendedClient;
	let bobClient: ExtendedClient;
	let oracleClient: ExtendedClient;
	let gitIdentityRegistryAddress: `0x${string}`;
	let sshKeysAvailable = false;
	let sshPrivateKeyPath: string;
	let sshPublicKey: { keyType: string; keyMaterial: string };

	beforeAll(async () => {
		const sshKeys = loadSSHKeyPaths();
		if (sshKeys) {
			sshPrivateKeyPath = sshKeys.privateKeyPath;
			sshPublicKey = parseSSHPublicKey(sshKeys.publicKeyPath);
			if (sshPublicKey.keyType.includes("ed25519")) {
				sshKeysAvailable = true;
			}
		}

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
		if (testContext?.anvilInitState) {
			await testContext.testClient.loadState({
				state: testContext.anvilInitState,
			});
		}
	});

	afterAll(async () => {
		// Anvil cleaned up on process exit
	});

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

	// Helper to set up escrow and fulfillment
	const setupEscrowAndFulfillment = async () => {
		const arbiter = testContext.addresses.trustedOracleArbiter;

		const commitTestsData = encodeCommitTestsDemand({
			testsCommitHash: `test-${Date.now()}`,
			testsCommitAlgo: CommitAlgo.SHA256,
			hosts: ["github.com/test/repo"],
		});

		const demand = aliceClient.arbiters.general.trustedOracle.encodeDemand({
			oracle,
			data: commitTestsData,
		});

		const { attested: escrow } =
			await aliceClient.erc20.escrow.default.permitAndCreate(
				{ address: testContext.mockAddresses.erc20A, value: 100n },
				{ arbiter, demand },
				0n,
			);

		const { attested: fulfillment } =
			await bobClient.commitObligation.doObligation(
				{
					commitHash: "solution-commit",
					commitAlgo: CommitAlgo.SHA256,
					hosts: ["github.com/bob/solution"],
				},
				escrow.uid,
			);

		const requestHash = await bobClient.arbiters.general.trustedOracle.requestArbitration(
			fulfillment.uid,
			oracle,
			demand,
		);

		// Wait for arbitration request to be confirmed
		await testContext.testClient.waitForTransactionReceipt({ hash: requestHash });

		return { escrow, fulfillment, demand };
	};

	// Helper to register Bob's key
	const registerBobKey = async () => {
		const nonce = `nonce_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
		const nonceHash = crypto.createHash("sha256").update(nonce, "utf8").digest("hex");
		const signingMessage = generateSigningMessage(bob, nonceHash);
		const signature = generateSSHSignature(
			fs.readFileSync(sshPrivateKeyPath, "utf8"),
			signingMessage,
		);

		const keyClaim = createGitKeyClaim(
			KeyType.SSHEd25519,
			nonceHash,
			signature,
			sshPublicKey.keyMaterial,
		);

		const result = await bobClient.gitIdentityRegistry.claimKey(keyClaim);
		await testContext.testClient.waitForTransactionReceipt({ hash: result.hash });
	};

	describe("without key verification", () => {
		test("oracle approves fulfillment", async () => {
			await setupEscrowAndFulfillment();

			const { decisions } =
				await oracleClient.arbiters.general.trustedOracle.arbitrateMany(
					async () => true, // Always approve
					{ mode: "past" },
				);

			expect(decisions.length).toBeGreaterThan(0);
			expect(decisions[decisions.length - 1]!.decision).toBe(true);
		}, 60000);

		test("oracle can reject fulfillment (returns false)", async () => {
			await setupEscrowAndFulfillment();

			// When callback returns false, a rejection decision is submitted on-chain
			const { decisions } =
				await oracleClient.arbiters.general.trustedOracle.arbitrateMany(
					async () => false,
					{ mode: "past" },
				);

			expect(decisions.length).toBeGreaterThan(0);
			expect(decisions[decisions.length - 1]!.decision).toBe(false);
		}, 60000);

		test("oracle can skip arbitration (returns null)", async () => {
			await setupEscrowAndFulfillment();

			// When callback returns null, no on-chain decision is recorded
			// The request remains pending for future arbitration
			const { decisions } =
				await oracleClient.arbiters.general.trustedOracle.arbitrateMany(
					async () => null,
					{ mode: "past" },
				);

			// No decision recorded when skipping
			expect(decisions.length).toBe(0);
		}, 60000);
	});

	describe("with key verification", () => {
		test("verifies seller key exists during arbitration", async () => {
			if (!sshKeysAvailable) {
				console.log("Skipping: SSH keys not configured");
				return;
			}

			// Setup escrow and fulfillment first
			await setupEscrowAndFulfillment();

			// Register Bob's key
			await registerBobKey();

			// Verify key can be retrieved during arbitration
			const { decisions } =
				await oracleClient.arbiters.general.trustedOracle.arbitrateMany(
					async () => {
						const bobKey = await getRegisteredKey(
							testContext.testClient,
							gitIdentityRegistryAddress,
							bob,
						);

						expect(bobKey).not.toBeNull();
						expect(bobKey!.keyType).toBe(KeyType.SSHEd25519);

						return true; // Approve since key is valid
					},
					{ mode: "past" },
				);

			expect(decisions.length).toBeGreaterThan(0);
			expect(decisions[decisions.length - 1]!.decision).toBe(true);
		}, 60000);

		test("detects missing seller key during arbitration", async () => {
			if (!sshKeysAvailable) {
				console.log("Skipping: SSH keys not configured");
				return;
			}

			// Setup without registering key
			await setupEscrowAndFulfillment();

			// Verify key lookup returns null for unregistered user
			const bobKey = await getRegisteredKey(
				testContext.testClient,
				gitIdentityRegistryAddress,
				bob,
			);

			expect(bobKey).toBeNull();
		}, 60000);
	});

});
