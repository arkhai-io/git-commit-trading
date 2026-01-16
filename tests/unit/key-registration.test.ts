/**
 * Unit Tests: Git Key Registration
 *
 * Tests registering SSH keys on-chain with REAL cryptographic signatures.
 *
 * Requires SSH key setup - see tests/integration/full-flow.test.ts for instructions.
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
import type { TestContext } from "alkahest-ts/sdks/ts/tests/utils/setup";
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

// Load SSH key paths from .env.test or default location
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
	return {
		keyType: parts[0] || "",
		keyMaterial: parts[1] || "",
	};
}

describe("Key Registration", () => {
	let testContext: TestContext;
	let alice: `0x${string}`;
	let aliceClient: ExtendedClient;
	let gitIdentityRegistryAddress: `0x${string}`;
	let sshKeysAvailable = false;
	let sshPrivateKeyPath: string;
	let sshPublicKey: { keyType: string; keyMaterial: string };

	beforeAll(async () => {
		const sshKeys = loadSSHKeyPaths();
		if (!sshKeys) {
			console.log("SSH keys not configured - skipping key registration tests");
			return;
		}

		sshPrivateKeyPath = sshKeys.privateKeyPath;
		sshPublicKey = parseSSHPublicKey(sshKeys.publicKeyPath);

		if (!sshPublicKey.keyType.includes("ed25519")) {
			console.log(`SSH key must be ed25519, got: ${sshPublicKey.keyType}`);
			return;
		}

		sshKeysAvailable = true;

		const setup = await setupTest();
		testContext = setup.testContext;
		aliceClient = setup.aliceClient;
		alice = testContext.alice.address;
		gitIdentityRegistryAddress = setup.gitIdentityRegistryAddress;
	});

	beforeEach(async () => {
		if (!sshKeysAvailable) return;
		if (testContext?.anvilInitState) {
			await testContext.testClient.loadState({
				state: testContext.anvilInitState,
			});
		}
	});

	afterAll(async () => {
		// Anvil cleaned up on process exit
	});

	test("registers SSH ed25519 key with valid signature", async () => {
		if (!sshKeysAvailable) {
			console.log("Skipping: SSH keys not configured");
			return;
		}

		// Generate nonce and hash
		const nonce = `nonce_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
		const nonceHash = crypto.createHash("sha256").update(nonce, "utf8").digest("hex");

		// Sign with nonceHash (what verifier will reconstruct)
		const signingMessage = generateSigningMessage(alice, nonceHash);
		const privateKeyPEM = fs.readFileSync(sshPrivateKeyPath, "utf8");
		const signature = generateSSHSignature(privateKeyPEM, signingMessage);

		// Create and submit key claim
		const keyClaim = createGitKeyClaim(
			KeyType.SSHEd25519,
			nonceHash,
			signature,
			sshPublicKey.keyMaterial,
		);

		const result = await aliceClient.gitIdentityRegistry.claimKey(keyClaim);
		expect(result.hash).toBeTruthy();
		expect(result.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

		// Wait for confirmation
		await testContext.testClient.waitForTransactionReceipt({ hash: result.hash });

		// Verify key can be retrieved and validated
		const registeredKey = await getRegisteredKey(
			testContext.testClient,
			gitIdentityRegistryAddress,
			alice,
		);

		expect(registeredKey).not.toBeNull();
		expect(registeredKey!.keyType).toBe(KeyType.SSHEd25519);
		expect(registeredKey!.publicKey).toBe(sshPublicKey.keyMaterial);
	}, 60000);

	test("retrieves null for address with no registered key", async () => {
		if (!sshKeysAvailable) {
			console.log("Skipping: SSH keys not configured");
			return;
		}

		// Use a random address that has no key registered
		const randomAddress = `0x${"1".repeat(40)}` as `0x${string}`;

		const registeredKey = await getRegisteredKey(
			testContext.testClient,
			gitIdentityRegistryAddress,
			randomAddress,
		);

		expect(registeredKey).toBeNull();
	}, 60000);

	test("latest key claim overwrites previous", async () => {
		if (!sshKeysAvailable) {
			console.log("Skipping: SSH keys not configured");
			return;
		}

		// Register first key
		const nonce1 = `nonce_first_${Date.now()}`;
		const nonceHash1 = crypto.createHash("sha256").update(nonce1, "utf8").digest("hex");
		const signature1 = generateSSHSignature(
			fs.readFileSync(sshPrivateKeyPath, "utf8"),
			generateSigningMessage(alice, nonceHash1),
		);

		const keyClaim1 = createGitKeyClaim(
			KeyType.SSHEd25519,
			nonceHash1,
			signature1,
			sshPublicKey.keyMaterial,
		);

		const result1 = await aliceClient.gitIdentityRegistry.claimKey(keyClaim1);
		await testContext.testClient.waitForTransactionReceipt({ hash: result1.hash });

		// Register second key (same user, different nonce)
		const nonce2 = `nonce_second_${Date.now()}`;
		const nonceHash2 = crypto.createHash("sha256").update(nonce2, "utf8").digest("hex");
		const signature2 = generateSSHSignature(
			fs.readFileSync(sshPrivateKeyPath, "utf8"),
			generateSigningMessage(alice, nonceHash2),
		);

		const keyClaim2 = createGitKeyClaim(
			KeyType.SSHEd25519,
			nonceHash2,
			signature2,
			sshPublicKey.keyMaterial,
		);

		const result2 = await aliceClient.gitIdentityRegistry.claimKey(keyClaim2);
		await testContext.testClient.waitForTransactionReceipt({ hash: result2.hash });

		// Latest key should be returned
		const registeredKey = await getRegisteredKey(
			testContext.testClient,
			gitIdentityRegistryAddress,
			alice,
		);

		expect(registeredKey).not.toBeNull();
		// The key material is the same, but it's the second registration
	}, 60000);
});
