/**
 * Key validation utilities for PGP, X509, and SSH keys
 */
import { X509Certificate } from "@peculiar/x509";
import * as openpgp from "openpgp";
import { KeyType } from "../clients/gitIdentityRegistry.js";
import { verifyPGPSignature } from "./signatures.js";

// Type extensions for library types that don't expose all properties
interface KeyPacketExtended {
	getBitSize?: () => number;
	publicParams?: {
		n?: { bitLength: () => number };
	};
}

interface X509CertExtended {
	keyUsages?: string[];
	signatureAlgorithm: { name?: string };
}

/**
 * Validate PGP key format and extract metadata
 * @param pgpKey - PGP public key in armored format
 * @returns Key metadata
 */
export async function validatePGPKey(pgpKey: string): Promise<{
	keyId: string;
	fingerprint: string;
	userIds: string[];
	algorithm: string;
	keySize: number;
	creationTime: Date;
	expirationTime?: Date;
}> {
	try {
		const key = await openpgp.readKey({ armoredKey: pgpKey });

		// Validate key structure
		if (!key.isPrivate() && !key.toPublic()) {
			throw new Error("Invalid PGP key structure");
		}

		// Check for primary key
		if (!key.keyPacket) {
			throw new Error("PGP key missing primary key packet");
		}

		// Validate user IDs
		const userIds = key.getUserIDs();
		if (!userIds || userIds.length === 0) {
			throw new Error("PGP key must have at least one user ID");
		}

		const primaryUser = await key.getPrimaryUser();
		if (!primaryUser || !primaryUser.user) {
			throw new Error("PGP key must have a primary user");
		}

		const keyPacket = key.keyPacket;

		// Validate key IDs
		const keyIds = key.getKeyIDs();
		if (!keyIds || keyIds.length === 0) {
			throw new Error("PGP key must have at least one key ID");
		}

		const firstKeyId = keyIds[0];
		const keyId = firstKeyId ? firstKeyId.toHex() : "";
		if (!keyId) {
			throw new Error("Failed to extract key ID from PGP key");
		}

		// Validate fingerprint
		const fingerprint = key.getFingerprint();
		if (!fingerprint || fingerprint.length < 40) {
			throw new Error("Invalid or missing PGP key fingerprint");
		}

		const expirationTime = await key.getExpirationTime();

		// Extract key size with proper validation
		let keySize = 0;
		try {
			const extendedPacket = keyPacket as KeyPacketExtended;
			if (extendedPacket.getBitSize) {
				keySize = extendedPacket.getBitSize();
			} else if (extendedPacket.publicParams) {
				// For RSA keys, try to get key size from public parameters
				const publicParams = extendedPacket.publicParams;
				if (publicParams.n?.bitLength) {
					keySize = publicParams.n.bitLength();
				}
			}

			// If we got a valid key size, validate it
			if (keySize > 0 && keySize < 1024) {
				throw new Error(`Key size (${keySize} bits) is too small and insecure`);
			}

			// Note: keySize of 0 means we couldn't determine it, which is acceptable
			// for some key types (like ECC keys). The key structure validation above
			// already confirmed the key is valid.
		} catch (error) {
			if (error instanceof Error && error.message.includes("Key size")) {
				throw error; // Re-throw our validation errors
			}
			// If we can't extract key size, log but don't fail
			// The key structure has already been validated above
			keySize = 0;
		}

		// Validate algorithm
		const algorithm = String(keyPacket.algorithm);
		if (!algorithm || algorithm === "undefined") {
			throw new Error("PGP key has invalid or missing algorithm");
		}

		// Validate creation time
		if (!keyPacket.created || !(keyPacket.created instanceof Date)) {
			throw new Error("PGP key has invalid or missing creation time");
		}

		return {
			keyId,
			fingerprint,
			userIds,
			algorithm,
			keySize,
			creationTime: keyPacket.created,
			expirationTime:
				expirationTime instanceof Date ? expirationTime : undefined,
		};
	} catch (error) {
		throw new Error(`Failed to validate PGP key: ${error}`);
	}
}

/**
 * Validate X509 certificate format and extract metadata
 * @param x509Cert - X509 certificate in PEM format
 * @returns Certificate metadata
 */
export function validateX509Certificate(x509Cert: string): {
	subject: string;
	issuer: string;
	serialNumber: string;
	notBefore: Date;
	notAfter: Date;
	keyUsage?: string[];
	publicKeyAlgorithm: string;
	signatureAlgorithm: string;
} {
	try {
		const cert = new X509Certificate(x509Cert);

		return {
			subject: cert.subject,
			issuer: cert.issuer,
			serialNumber: cert.serialNumber,
			notBefore: cert.notBefore,
			notAfter: cert.notAfter,
			keyUsage: (cert as unknown as X509CertExtended).keyUsages || [],
			publicKeyAlgorithm: cert.publicKey.algorithm.name,
			signatureAlgorithm:
				(cert.signatureAlgorithm as X509CertExtended["signatureAlgorithm"])
					.name || "unknown",
		};
	} catch (error) {
		throw new Error(`Failed to validate X509 certificate: ${error}`);
	}
}

/**
 * Validate that a key is suitable for Git signing
 * @param keyType - Type of the key
 * @param keyMaterial - Key material
 * @returns Validation result with any warnings
 */
export async function validateKeyForGitSigning(
	keyType: KeyType,
	keyMaterial: string,
): Promise<{
	valid: boolean;
	warnings: string[];
	errors: string[];
}> {
	const warnings: string[] = [];
	const errors: string[] = [];

	try {
		switch (keyType) {
			case KeyType.PGPv4: {
				// Validate PGP key structure and metadata
				let metadata: Awaited<ReturnType<typeof validatePGPKey>>;
				try {
					metadata = await validatePGPKey(keyMaterial);
				} catch (validationError) {
					errors.push(
						`PGP key validation failed: ${validationError instanceof Error ? validationError.message : String(validationError)}`,
					);
					break;
				}

				// Check for required fields
				if (!metadata.fingerprint) {
					errors.push("PGP key is missing fingerprint");
				}

				if (!metadata.keyId) {
					errors.push("PGP key is missing key ID");
				}

				if (!metadata.userIds || metadata.userIds.length === 0) {
					errors.push("PGP key must have at least one user ID");
				}

				// Check creation time is not in the future
				if (metadata.creationTime > new Date()) {
					errors.push("PGP key creation time is in the future");
				}

				// Check expiration
				if (metadata.expirationTime) {
					if (metadata.expirationTime < new Date()) {
						errors.push("PGP key has expired");
					} else if (
						metadata.expirationTime <
						new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
					) {
						warnings.push("PGP key will expire within 30 days");
					}
				}

				// Check key size (if determinable)
				if (metadata.keySize > 0) {
					if (metadata.keySize < 1024) {
						errors.push(
							`PGP key size (${metadata.keySize} bits) is dangerously small and insecure`,
						);
					} else if (metadata.keySize < 2048) {
						warnings.push(
							`PGP key size (${metadata.keySize} bits) is below recommended 2048 bits`,
						);
					}
				} else {
					// Key size couldn't be determined (common with ECC keys)
					warnings.push(
						"Could not determine PGP key size (this is normal for some key types like ECC)",
					);
				}

				// Check algorithm is supported
				const supportedAlgorithms = [
					"1",
					"2",
					"3",
					"16",
					"17",
					"18",
					"19",
					"22",
				]; // RSA, DSA, ElGamal, ECDH, ECDSA, EdDSA
				if (!supportedAlgorithms.includes(metadata.algorithm)) {
					warnings.push(
						`PGP key algorithm (${metadata.algorithm}) may not be widely supported`,
					);
				}

				// Additional format validation
				if (!keyMaterial.includes("-----BEGIN PGP PUBLIC KEY BLOCK-----")) {
					errors.push("PGP key must be in ASCII armored format");
				}

				if (!keyMaterial.includes("-----END PGP PUBLIC KEY BLOCK-----")) {
					errors.push("PGP key is missing end marker");
				}

				// Check for minimum key material length (rough estimate)
				if (keyMaterial.length < 200) {
					errors.push("PGP key appears to be truncated or incomplete");
				}

				break;
			}

			case KeyType.X509: {
				const metadata = validateX509Certificate(keyMaterial);

				// Check validity period
				const now = new Date();
				if (metadata.notAfter < now) {
					errors.push("X509 certificate has expired");
				} else if (
					metadata.notAfter < new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
				) {
					warnings.push("X509 certificate will expire within 30 days");
				}

				if (metadata.notBefore > now) {
					errors.push("X509 certificate is not yet valid");
				}

				// Check key usage
				if (
					metadata.keyUsage &&
					!metadata.keyUsage.includes("digitalSignature")
				) {
					warnings.push(
						"X509 certificate does not include digital signature key usage",
					);
				}

				break;
			}

			case KeyType.SSHEd25519:
			case KeyType.SSHSecp256k1:
				// SSH keys don't have built-in expiration, so just validate format
				if (!keyMaterial || keyMaterial.length < 10) {
					errors.push("SSH key material appears to be too short");
				}
				break;

			default:
				errors.push(`Unsupported key type: ${keyType}`);
		}
	} catch (error) {
		errors.push(`Key validation failed: ${error}`);
	}

	return {
		valid: errors.length === 0,
		warnings,
		errors,
	};
}

/**
 * Validate PGP key registration data
 * @param registrationData - Registration data to validate
 * @returns Promise<{valid: boolean, errors: string[]}> - Validation result
 */
export async function validatePGPKeyRegistration(registrationData: {
	publicKey: string;
	signature: string;
	ethereumAddress: string;
	nonce: string;
}): Promise<{ valid: boolean; errors: string[] }> {
	const errors: string[] = [];

	try {
		// Validate public key format
		if (
			!registrationData.publicKey.includes(
				"-----BEGIN PGP PUBLIC KEY BLOCK-----",
			)
		) {
			errors.push("Invalid PGP public key format");
		}

		// Validate signature format
		if (
			!registrationData.signature.includes("-----BEGIN PGP SIGNED MESSAGE-----")
		) {
			errors.push("Invalid PGP signature format");
		}

		// Verify the signature
		const verificationResult = await verifyPGPSignature(
			registrationData.signature,
			registrationData.publicKey,
		);

		if (!verificationResult.verified) {
			errors.push("PGP signature verification failed");
		} else {
			// Check if the signed message matches the expected format
			const expectedMessage = `${registrationData.ethereumAddress} ${registrationData.nonce}`;
			if (verificationResult.message.trim() !== expectedMessage) {
				errors.push("Signed message does not match expected format");
			}
		}

		// Validate Ethereum address format
		if (!/^0x[a-fA-F0-9]{40}$/.test(registrationData.ethereumAddress)) {
			errors.push("Invalid Ethereum address format");
		}

		return {
			valid: errors.length === 0,
			errors,
		};
	} catch (error) {
		errors.push(`Validation error: ${error}`);
		return {
			valid: false,
			errors,
		};
	}
}
