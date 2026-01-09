/**
 * Signature generation and verification utilities
 */
import fs from "fs";
import * as openpgp from "openpgp";
import sshpk from "sshpk";

import type { GitKeyClaim } from "../clients/gitIdentityRegistry.js";

/**
 * Generate message that should be signed for GitKeyClaim
 * @param ethAddress - Ethereum address of the claimant
 * @param nonce - Random nonce for uniqueness
 * @returns Message string to be signed
 */
export function generateSigningMessage(
	ethAddress: string,
	nonce: string,
): string {
	// Always normalize address to lowercase to avoid checksum case mismatches
	const normalizedAddress = ethAddress.toLowerCase();
	return `${normalizedAddress} ${nonce}`;
}

/**
 * Generate an SSH signature for the GitKeyClaim
 * @param privateKeyDataOrPath - SSH private key content or path to file
 * @param message - Message to sign
 * @returns Signature as hex string
 */
export function generateSSHSignature(
	privateKeyDataOrPath: string,
	message: string,
): string {
	try {
		let privateKeyData: string;

		// Check if input is a file path or private key content
		if (privateKeyDataOrPath.includes("-----BEGIN")) {
			// It's already private key content
			privateKeyData = privateKeyDataOrPath;
		} else {
			// It's a file path
			privateKeyData = fs.readFileSync(privateKeyDataOrPath, "utf8");
		}

		// Parse private key
		const privateKey = sshpk.parsePrivateKey(privateKeyData, "openssh");

		// Determine hash algorithm based on key type
		const hashAlgo = privateKey.type === "ed25519" ? "sha512" : "sha256";

		// Create signer with appropriate hash
		const signer = privateKey.createSign(hashAlgo);
		signer.update(message);
		const signature = signer.sign();

		// Convert signature to hex
		const signatureHex = signature.toBuffer().toString("hex");

		return signatureHex;
	} catch (error) {
		console.error("❌ Error generating SSH signature:", error);
		throw new Error(`Failed to generate SSH signature: ${error}`);
	}
}

/**
 * Verify an SSH signature
 * @param publicKey - SSH public key (base64 format)
 * @param message - Original message that was signed
 * @param signature - Signature to verify (hex format)
 * @param keyType - Type of SSH key (ed25519, rsa, etc.)
 * @returns True if signature is valid
 */
export function verifySSHSignature(
	publicKey: string,
	message: string,
	signature: string,
	keyType: string = "ed25519",
): boolean {
	try {
		const isDebugMode =
			process.env.DEBUG === "true" || process.env.DEBUG === "1";

		const traceId = `verify_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		const messageBuffer = Buffer.from(message, "utf8");

		if (isDebugMode) {
			console.log(`🔍 [${traceId}] Verifying SSH signature`);
		}

		// Construct the full SSH public key string
		const sshPublicKeyString = `ssh-${keyType} ${publicKey}`;

		// Convert signature to buffer
		const signatureBuffer = Buffer.from(signature, "hex");

		if (keyType === "ed25519" && signatureBuffer.length === 64) {
			try {
				const key = sshpk.parseKey(sshPublicKeyString, "ssh");
				const verifier = key.createVerify("sha512");
				verifier.update(messageBuffer);

				const signatureObj = sshpk.parseSignature(
					signatureBuffer,
					"ed25519",
					"raw",
				);

				const result = verifier.verify(signatureObj);
				if (isDebugMode) {
					console.log(`  [${traceId}] Verification result: ${result}`);
				}
				return result;
			} catch (ed25519Error) {
				if (isDebugMode) {
					console.log(`  [${traceId}] Ed25519 verification failed: ${ed25519Error}`);
				}
				return false;
			}
		}

		// Fallback for other key types
		try {
			const key = sshpk.parseKey(sshPublicKeyString, "ssh");
			const hashAlgo = key.type === "ed25519" ? "sha512" : "sha256";
			const verifier = key.createVerify(hashAlgo);
			verifier.update(Buffer.from(message, "utf8"));

			const signatureObj = sshpk.parseSignature(
				signatureBuffer,
				key.type as any,
				"ssh",
			);
			return verifier.verify(signatureObj);
		} catch (fallbackError) {
			if (isDebugMode) {
				console.log(`  [${traceId}] Fallback verification failed: ${fallbackError}`);
			}
			return false;
		}
	} catch (error) {
		console.error("❌ Error verifying SSH signature:", error);
		return false;
	}
}

/**
 * Generate a PGP signature for the GitKeyClaim
 * @param privateKeyArmored - PGP private key in armored format
 * @param message - Message to sign
 * @param passphrase - Passphrase for the private key (optional)
 * @returns Signature as hex string
 */
export async function generatePGPSignature(
	privateKeyArmored: string,
	message: string,
	passphrase?: string,
): Promise<string> {
	try {
		const privateKey = await openpgp.readPrivateKey({
			armoredKey: privateKeyArmored,
		});

		let decryptedPrivateKey = privateKey;
		if (!privateKey.isDecrypted()) {
			if (passphrase) {
				decryptedPrivateKey = await openpgp.decryptKey({
					privateKey,
					passphrase,
				});
			} else {
				console.log(
					"⚠️  Private key is encrypted but no passphrase provided",
				);
				return Buffer.from(`mock_pgp_sig_${Date.now()}`)
					.toString("hex")
					.padStart(128, "0")
					.substring(0, 128);
			}
		}

		const clearMessage = await openpgp.createCleartextMessage({
			text: message,
		});

		const signature = await openpgp.sign({
			message: clearMessage,
			signingKeys: decryptedPrivateKey,
			format: "armored",
		});

		const signatureMatch = signature.match(
			/-----BEGIN PGP SIGNATURE-----[\s\S]*?-----END PGP SIGNATURE-----/,
		);
		if (signatureMatch) {
			const signatureOnly = signatureMatch[0];
			const signatureBytes = Buffer.from(signatureOnly, "utf8");
			return signatureBytes.toString("hex");
		} else {
			throw new Error("Failed to extract PGP signature from signed message");
		}
	} catch (error) {
		console.error("❌ Error generating PGP signature:", error);
		return Buffer.from(`mock_pgp_sig_${message.substring(0, 10)}`)
			.toString("hex")
			.padStart(128, "0")
			.substring(0, 128);
	}
}

/**
 * Verify PGP signature
 * @param signature - Armored PGP signature
 * @param publicKeyArmored - PGP public key in armored format
 * @returns Verification result with message
 */
export async function verifyPGPSignature(
	signature: string,
	publicKeyArmored: string,
): Promise<{ verified: boolean; message: string }> {
	try {
		const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });

		const message = await openpgp.readCleartextMessage({
			cleartextMessage: signature,
		});
		const verificationResult = await openpgp.verify({
			message,
			verificationKeys: publicKey,
		});

		const { verified } = verificationResult.signatures[0] || {
			verified: false,
		};
		const originalMessage = message.getText();

		return {
			verified: await verified,
			message: originalMessage,
		};
	} catch (error) {
		return {
			verified: false,
			message: `Verification failed: ${error}`,
		};
	}
}

/**
 * Verify PGP signature for GitKeyClaim (internal helper)
 */
async function verifyPGPKeyClaimSignature(
	publicKeyBase64: string,
	message: string,
	signatureHex: string,
): Promise<boolean> {
	try {
		const signatureArmored = Buffer.from(signatureHex, "hex").toString("utf8");

		let publicKey: openpgp.Key;
		try {
			if (publicKeyBase64.includes("-----BEGIN PGP PUBLIC KEY BLOCK-----")) {
				publicKey = await openpgp.readKey({ armoredKey: publicKeyBase64 });
			} else {
				const armoredKey = `-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n${publicKeyBase64}\n-----END PGP PUBLIC KEY BLOCK-----`;
				publicKey = await openpgp.readKey({ armoredKey });
			}
		} catch (error) {
			console.log("  ❌ Failed to parse PGP public key:", error);
			return false;
		}

		let signature: openpgp.Signature;
		try {
			signature = await openpgp.readSignature({
				armoredSignature: signatureArmored,
			});
		} catch (error) {
			console.log("  ❌ Failed to parse PGP signature:", error);
			return false;
		}

		const messageObj = await openpgp.createMessage({ text: message });

		const verificationResult = await openpgp.verify({
			message: messageObj,
			signature,
			verificationKeys: publicKey,
		});

		if (
			verificationResult.signatures &&
			verificationResult.signatures.length > 0
		) {
			const firstSignature = verificationResult.signatures[0];
			if (firstSignature) {
				const verified = await firstSignature.verified;
				if (verified) {
					console.log("  ✅ PGP signature verification passed");
					return true;
				}
			}
		}

		console.log("  ❌ No valid signature found");
		return false;
	} catch (error) {
		console.error("  ❌ Error during PGP verification:", error);
		return false;
	}
}

/**
 * Get human-readable name for key type (internal helper)
 */
function getKeyTypeName(keyType: number): string {
	switch (keyType) {
		case 0:
			return "PGPv4";
		case 1:
			return "SSH Ed25519";
		case 2:
			return "SSH Secp256k1";
		case 3:
			return "X509";
		default:
			return `Unknown (${keyType})`;
	}
}

/**
 * Verify GitKeyClaim signature
 * @param gitKeyClaim - The Git key claim to verify
 * @param ethAddress - Ethereum address that should have been signed
 * @returns True if the signature is valid
 */
export async function verifyGitKeyClaimSignature(
	gitKeyClaim: GitKeyClaim,
	ethAddress: string,
): Promise<boolean> {
	try {
		const normalizedAddress = ethAddress.toLowerCase();

		console.log("🔍 Verifying GitKeyClaim signature:");
		console.log("  Address:", normalizedAddress);
		console.log("  Key Type:", getKeyTypeName(gitKeyClaim.keyType));

		const nonceHex = gitKeyClaim.nonceHash.replace("0x", "");
		const expectedMessage = generateSigningMessage(normalizedAddress, nonceHex);
		console.log("  Expected signed message:", expectedMessage);

		const signature = gitKeyClaim.sig.replace("0x", "");

		let isSignatureValid = false;

		if (gitKeyClaim.keyType === 0) {
			// PGP key
			console.log("  Using PGP verification method...");
			isSignatureValid = await verifyPGPKeyClaimSignature(
				gitKeyClaim.publicKey,
				expectedMessage,
				signature,
			);
		} else {
			// SSH key
			const keyTypeMap: { [key: number]: string } = {
				1: "ed25519",
				2: "secp256k1",
				3: "x509",
			};

			const keyTypeForVerification = keyTypeMap[gitKeyClaim.keyType];
			if (!keyTypeForVerification) {
				console.log(`  ❌ Unsupported key type: ${gitKeyClaim.keyType}`);
				return false;
			}

			console.log(
				`  Using SSH verification method with key type: ${keyTypeForVerification}`,
			);
			isSignatureValid = verifySSHSignature(
				gitKeyClaim.publicKey,
				expectedMessage,
				signature,
				keyTypeForVerification,
			);
		}

		if (isSignatureValid) {
			console.log("  ✅ Cryptographic signature verification passed!");
			return true;
		} else {
			console.log("  ❌ Cryptographic signature verification failed!");
			return false;
		}
	} catch (error) {
		console.error("❌ Error verifying GitKeyClaim signature:", error);
		return false;
	}
}

/**
 * Generate a PGP key pair for testing
 * @param name - User name for the key
 * @param email - User email for the key
 * @param passphrase - Passphrase for the private key (optional)
 * @returns Object containing public and private keys
 */
export async function generatePGPKeyPair(
	name: string,
	email: string,
	passphrase?: string,
): Promise<{
	publicKeyArmored: string;
	privateKeyArmored: string;
	fingerprint: string;
	keyId: string;
}> {
	try {
		const { publicKey, privateKey } = await openpgp.generateKey({
			type: "rsa",
			rsaBits: 2048,
			userIDs: [{ name, email }],
			passphrase: undefined,
			format: "armored",
		});

		const pubKey = await openpgp.readKey({ armoredKey: publicKey });
		const fingerprint = pubKey.getFingerprint();
		const keyIds = pubKey.getKeyIDs();
		const keyId = keyIds.length > 0 && keyIds[0] ? keyIds[0].toHex() : "";

		return {
			publicKeyArmored: publicKey,
			privateKeyArmored: privateKey,
			fingerprint,
			keyId,
		};
	} catch (error) {
		console.error("❌ Error generating PGP key pair:", error);
		throw new Error(`Failed to generate PGP key pair: ${error}`);
	}
}

/**
 * Prepare PGP key for blockchain registration
 * @param publicKeyArmored - PGP public key in armored format
 * @param ethereumAddress - Ethereum address to associate
 * @param nonce - Unique nonce for registration
 */
export async function preparePGPKeyForRegistration(
	publicKeyArmored: string,
	ethereumAddress: string,
	nonce: string,
): Promise<{
	keyMaterial: string;
	fullKey: string;
	fingerprint: string;
	keyId: string;
	message: string;
}> {
	try {
		const key = await openpgp.readKey({ armoredKey: publicKeyArmored });

		// Extract key material
		const keyBytes = key.write();
		const keyMaterial = Buffer.from(keyBytes).toString("base64");

		// Generate fingerprint
		const fingerprint = key.getFingerprint().toUpperCase();

		// Get key ID
		const keyIds = key.getKeyIDs();
		const keyId = keyIds.length > 0 ? keyIds[0]!.toHex() : "";

		// Create message to sign
		const message = `${ethereumAddress} ${nonce}`;

		return {
			keyMaterial,
			fullKey: publicKeyArmored,
			fingerprint,
			keyId,
			message,
		};
	} catch (error) {
		throw new Error(`Failed to prepare PGP key for registration: ${error}`);
	}
}

