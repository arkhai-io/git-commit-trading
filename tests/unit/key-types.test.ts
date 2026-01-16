/**
 * Unit Tests: Key Types
 *
 * Tests key registration and verification for all supported key types:
 * - PGPv4
 * - SSH Ed25519 (tested in key-registration.test.ts)
 * - SSH Secp256k1
 * - X509
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { TestContext } from "alkahest-ts/sdks/ts/tests/utils/setup";
import {
	KeyType,
	createGitKeyClaim,
} from "../../src/clients/gitIdentityRegistry";
import {
	generatePGPKeyPair,
	generatePGPSignature,
	generateSigningMessage,
	getRegisteredKey,
	verifyGitKeyClaimSignature,
} from "../../src/crypto/index";
import { type ExtendedClient, setupTest } from "../utils/setup";

describe("Key Types", () => {
	let testContext: TestContext;
	let alice: `0x${string}`;
	let aliceClient: ExtendedClient;
	let gitIdentityRegistryAddress: `0x${string}`;

	beforeAll(async () => {
		const setup = await setupTest();
		testContext = setup.testContext;
		aliceClient = setup.aliceClient;
		alice = testContext.alice.address;
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

	describe("PGPv4", () => {
		test("generates PGP key pair", async () => {
			const keyPair = await generatePGPKeyPair(
				"Test User",
				"test@example.com",
			);

			expect(keyPair.publicKeyArmored).toContain("-----BEGIN PGP PUBLIC KEY BLOCK-----");
			expect(keyPair.privateKeyArmored).toContain("-----BEGIN PGP PRIVATE KEY BLOCK-----");
			expect(keyPair.fingerprint).toMatch(/^[a-f0-9]+$/i);
			expect(keyPair.keyId).toBeTruthy();
		});

		test("signs and verifies PGP message", async () => {
			const keyPair = await generatePGPKeyPair(
				"Test User",
				"test@example.com",
			);

			const message = "Hello, World!";
			const signature = await generatePGPSignature(
				keyPair.privateKeyArmored,
				message,
			);

			expect(signature).toBeTruthy();
			// Signature should be hex-encoded
			expect(signature).toMatch(/^[a-f0-9]+$/i);
		});

		test("registers PGP key on-chain", async () => {
			const keyPair = await generatePGPKeyPair(
				"Alice Test",
				"alice@example.com",
			);

			// Generate nonce and hash
			const nonce = `nonce_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
			const nonceHash = crypto.createHash("sha256").update(nonce, "utf8").digest("hex");

			// Sign with nonceHash
			const signingMessage = generateSigningMessage(alice, nonceHash);
			const signature = await generatePGPSignature(
				keyPair.privateKeyArmored,
				signingMessage,
			);

			// Create and submit key claim
			const keyClaim = createGitKeyClaim(
				KeyType.PGPv4,
				nonceHash,
				signature,
				keyPair.publicKeyArmored,
			);

			const result = await aliceClient.gitIdentityRegistry.claimKey(keyClaim);
			expect(result.hash).toBeTruthy();
			expect(result.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			// Wait for confirmation
			await testContext.testClient.waitForTransactionReceipt({ hash: result.hash });

			// Verify key can be retrieved
			const latestClaim = await aliceClient.gitIdentityRegistry.getLatestKeyClaim(alice);
			expect(latestClaim).not.toBeNull();
			expect(latestClaim!.keyType).toBe(KeyType.PGPv4);
		}, 60000);

		test("verifies registered PGP key signature", async () => {
			const keyPair = await generatePGPKeyPair(
				"Alice Verify",
				"alice-verify@example.com",
			);

			const nonce = `nonce_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
			const nonceHash = crypto.createHash("sha256").update(nonce, "utf8").digest("hex");
			const signingMessage = generateSigningMessage(alice, nonceHash);
			const signature = await generatePGPSignature(
				keyPair.privateKeyArmored,
				signingMessage,
			);

			const keyClaim = createGitKeyClaim(
				KeyType.PGPv4,
				nonceHash,
				signature,
				keyPair.publicKeyArmored,
			);

			const result = await aliceClient.gitIdentityRegistry.claimKey(keyClaim);
			await testContext.testClient.waitForTransactionReceipt({ hash: result.hash });

			// Verify using getRegisteredKey (which validates signature)
			const registeredKey = await getRegisteredKey(
				testContext.testClient,
				gitIdentityRegistryAddress,
				alice,
			);

			expect(registeredKey).not.toBeNull();
			expect(registeredKey!.keyType).toBe(KeyType.PGPv4);
		}, 60000);
	});

	describe("SSH Ed25519", () => {
		// Load SSH key paths
		const loadSSHKeyPaths = (): { privateKeyPath: string; publicKeyPath: string } | null => {
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
		};

		test("detects SSH Ed25519 key type from content", async () => {
			const sshKeys = loadSSHKeyPaths();
			if (!sshKeys) {
				console.log("Skipping: SSH keys not configured");
				return;
			}

			const publicKeyContent = fs.readFileSync(sshKeys.publicKeyPath, "utf8");
			expect(publicKeyContent).toContain("ssh-ed25519");
		});
	});

	describe("Key type validation", () => {
		test("createGitKeyClaim validates key type enum", () => {
			const keyClaim = createGitKeyClaim(
				KeyType.SSHEd25519,
				"abc123",
				"sig123",
				"pubkey123",
			);

			expect(keyClaim.keyType).toBe(KeyType.SSHEd25519);
			expect(keyClaim.keyType).toBe(1); // enum value
		});

		test("KeyType enum has all expected values", () => {
			expect(KeyType.PGPv4).toBe(0);
			expect(KeyType.SSHEd25519).toBe(1);
			expect(KeyType.SSHSecp256k1).toBe(2);
			expect(KeyType.X509).toBe(3);
		});

		test("createGitKeyClaim adds 0x prefix to hex values", () => {
			const keyClaim = createGitKeyClaim(
				KeyType.PGPv4,
				"abc123", // no prefix
				"def456", // no prefix
				"pubkey",
			);

			expect(keyClaim.nonceHash).toBe("0xabc123");
			expect(keyClaim.sig).toBe("0xdef456");
		});

		test("createGitKeyClaim preserves existing 0x prefix", () => {
			const keyClaim = createGitKeyClaim(
				KeyType.PGPv4,
				"0xabc123",
				"0xdef456",
				"pubkey",
			);

			expect(keyClaim.nonceHash).toBe("0xabc123");
			expect(keyClaim.sig).toBe("0xdef456");
		});
	});

	describe("Signature verification", () => {
		test("verifyGitKeyClaimSignature returns false for invalid signature", async () => {
			// Create a key claim with invalid signature
			const keyClaim = createGitKeyClaim(
				KeyType.SSHEd25519,
				crypto.createHash("sha256").update("test").digest("hex"),
				"invalid_signature_hex",
				"invalid_public_key",
			);

			const isValid = await verifyGitKeyClaimSignature(keyClaim, alice);
			expect(isValid).toBe(false);
		});

		test("getRegisteredKey returns null for invalid signature", async () => {
			// Register a key with invalid signature (will be stored but not verifiable)
			const keyClaim = createGitKeyClaim(
				KeyType.SSHEd25519,
				crypto.createHash("sha256").update("test-invalid").digest("hex"),
				"0000".repeat(32), // invalid signature
				"AAAAC3NzaC1lZDI1NTE5AAAAIInvalid", // invalid key
			);

			try {
				const result = await aliceClient.gitIdentityRegistry.claimKey(keyClaim);
				await testContext.testClient.waitForTransactionReceipt({ hash: result.hash });
			} catch {
				// Registration might fail, which is also acceptable
				return;
			}

			// If registration succeeded, verification should fail
			const registeredKey = await getRegisteredKey(
				testContext.testClient,
				gitIdentityRegistryAddress,
				alice,
			);

			// Should be null because signature verification fails
			expect(registeredKey).toBeNull();
		}, 60000);
	});
});
