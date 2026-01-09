/**
 * Key extraction, detection, and formatting utilities
 */
import { X509Certificate } from "@peculiar/x509";
import * as openpgp from "openpgp";
import { KeyType } from "../clients/gitIdentityRegistry.js";

/**
 * Extract just the base64 key material from SSH public key
 * @param sshPublicKey - The full SSH public key string
 * @returns Just the base64-encoded key material (without algorithm prefix or comment)
 */
export function extractSSHKeyMaterial(sshPublicKey: string): string {
	const parts = sshPublicKey.trim().split(" ");
	if (parts.length < 2) {
		throw new Error("Invalid SSH public key format");
	}

	const base64Key = parts[1];

	if (!base64Key) {
		throw new Error("Invalid SSH public key format - missing key data");
	}

	return base64Key;
}

/**
 * Detect key type from key content
 * @param keyContent - The key content (could be SSH, PGP, or X509)
 * @returns KeyType enum value
 */
export function detectKeyTypeFromContent(keyContent: string): KeyType {
	const content = keyContent.trim();

	// SSH key detection
	if (content.includes("ssh-ed25519")) {
		return KeyType.SSHEd25519;
	} else if (
		content.includes("ssh-rsa") ||
		content.includes("ssh-dss") ||
		content.includes("ecdsa-sha2-")
	) {
		return KeyType.SSHSecp256k1;
	}

	// PGP key detection
	else if (
		content.includes("-----BEGIN PGP PUBLIC KEY BLOCK-----") ||
		content.includes("-----BEGIN PGP PRIVATE KEY BLOCK-----")
	) {
		return KeyType.PGPv4;
	}

	// X509 certificate detection
	else if (
		content.includes("-----BEGIN CERTIFICATE-----") ||
		content.includes("-----BEGIN X509 CERTIFICATE-----")
	) {
		return KeyType.X509;
	}

	// Try to detect based on base64 patterns
	else if (/^[A-Za-z0-9+/=]+$/.test(content)) {
		// Could be base64-encoded key material
		// Default to SSH Ed25519 for backward compatibility
		return KeyType.SSHEd25519;
	} else {
		throw new Error(
			"Unable to detect key type from content. Supported formats: SSH, PGP, X509",
		);
	}
}

/**
 * Extract key material from PGP public key
 * @param pgpKey - PGP public key in armored format
 * @returns Base64-encoded key material for blockchain registration
 */
export async function extractPGPKeyMaterial(pgpKey: string): Promise<string> {
	try {
		const key = await openpgp.readKey({ armoredKey: pgpKey });

		// Extract the binary key data and encode as base64
		const keyBytes = key.write();
		const keyMaterial = Buffer.from(keyBytes).toString("base64");

		return keyMaterial;
	} catch (error) {
		throw new Error(`Failed to parse PGP key: ${error}`);
	}
}

/**
 * Get full armored PGP key for Git verification
 * @param pgpKey - PGP public key in armored format
 * @returns Full armored key for Git import
 */
export function getFullPGPKey(pgpKey: string): string {
	return pgpKey;
}

/**
 * Generate PGP key fingerprint for verification matching
 * @param pgpKey - PGP public key in armored format or base64 material
 * @returns Uppercase fingerprint without spaces
 */
export async function generatePGPKeyFingerprint(
	pgpKey: string,
): Promise<string> {
	try {
		let key;

		// Handle both armored format and base64 key material
		if (pgpKey.includes("-----BEGIN PGP PUBLIC KEY BLOCK-----")) {
			// Full armored key
			key = await openpgp.readKey({ armoredKey: pgpKey });
		} else {
			// Base64 key material - construct armored format
			const armoredKey = `-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n${pgpKey}\n-----END PGP PUBLIC KEY BLOCK-----`;
			key = await openpgp.readKey({ armoredKey });
		}

		// Get fingerprint and format consistently
		const fingerprint = key.getFingerprint().toUpperCase();
		return fingerprint;
	} catch (error) {
		throw new Error(`Failed to generate PGP key fingerprint: ${error}`);
	}
}

/**
 * Extract certificate material from X509 certificate
 * @param x509Cert - X509 certificate in PEM format
 * @returns Base64-encoded certificate material
 */
export function extractX509CertMaterial(x509Cert: string): string {
	try {
		const cert = new X509Certificate(x509Cert);

		// Validate certificate structure
		if (!cert.publicKey) {
			throw new Error("Certificate does not contain a public key");
		}

		// For GitHub integration, return the full PEM certificate
		return x509Cert;
	} catch (error) {
		throw new Error(`Failed to parse X509 certificate: ${error}`);
	}
}

/**
 * Format key material for storage based on key type
 * @param keyType - Type of the key
 * @param rawKeyMaterial - Raw key material
 * @returns Formatted key material suitable for storage
 */
export function formatKeyForStorage(
	keyType: KeyType,
	rawKeyMaterial: string,
): string {
	const content = rawKeyMaterial.trim();

	switch (keyType) {
		case KeyType.PGPv4:
			// Ensure PGP keys are in full armored format
			if (!content.includes("-----BEGIN PGP PUBLIC KEY BLOCK-----")) {
				throw new Error("PGP key must be in armored format");
			}
			return content;

		case KeyType.X509:
			// Ensure X509 certificates are in full PEM format
			if (!content.includes("-----BEGIN CERTIFICATE-----")) {
				throw new Error("X509 certificate must be in PEM format");
			}
			return content;

		case KeyType.SSHEd25519:
		case KeyType.SSHSecp256k1:
			// For SSH keys, extract just the base64 key material
			if (content.includes(" ")) {
				const parts = content.split(" ");
				if (parts.length >= 2 && parts[1]) {
					return parts[1]; // Return just the base64 part
				}
			}
			return content;

		default:
			throw new Error(`Unsupported key type for formatting: ${keyType}`);
	}
}

/**
 * Get human-readable name for key type
 * @param keyType - KeyType enum value
 * @returns Human-readable string
 */
export function getKeyTypeName(keyType: KeyType): string {
	switch (keyType) {
		case KeyType.PGPv4:
			return "PGP v4";
		case KeyType.SSHEd25519:
			return "SSH Ed25519";
		case KeyType.SSHSecp256k1:
			return "SSH RSA/ECDSA";
		case KeyType.X509:
			return "X.509 Certificate";
		default:
			return `Unknown (${keyType})`;
	}
}

/**
 * Generate key fingerprint for different key types
 * @param keyType - Type of the key
 * @param keyMaterial - Key material
 * @returns Fingerprint as hex string
 */
export async function generateKeyFingerprint(
	keyType: KeyType,
	keyMaterial: string,
): Promise<string> {
	const crypto = await import("crypto");

	switch (keyType) {
		case KeyType.PGPv4: {
			try {
				const key = await openpgp.readKey({ armoredKey: keyMaterial });
				return key.getFingerprint();
			} catch {
				// Fallback to SHA256 hash of key material
				return crypto.createHash("sha256").update(keyMaterial).digest("hex");
			}
		}

		case KeyType.X509: {
			try {
				const cert = new X509Certificate(keyMaterial);
				// Use SHA256 hash of the certificate
				const certBuffer = Buffer.from(keyMaterial);
				return crypto.createHash("sha256").update(certBuffer).digest("hex");
			} catch {
				// Fallback to SHA256 hash of key material
				return crypto.createHash("sha256").update(keyMaterial).digest("hex");
			}
		}

		case KeyType.SSHEd25519:
		case KeyType.SSHSecp256k1: {
			// For SSH keys, hash the key material
			return crypto.createHash("sha256").update(keyMaterial).digest("hex");
		}

		default:
			throw new Error(
				`Unsupported key type for fingerprint generation: ${keyType}`,
			);
	}
}
