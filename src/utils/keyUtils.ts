import { X509Certificate } from "@peculiar/x509";
import * as openpgp from "openpgp";
import { KeyType } from "../clients/gitIdentityRegistry.js";

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
			if ((keyPacket as any).getBitSize) {
				keySize = (keyPacket as any).getBitSize();
			} else if ((keyPacket as any).publicParams) {
				// For RSA keys, try to get key size from public parameters
				const publicParams = (keyPacket as any).publicParams;
				if (publicParams.n && publicParams.n.bitLength) {
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
			keyUsage: (cert as any).keyUsages || [],
			publicKeyAlgorithm: cert.publicKey.algorithm.name,
			signatureAlgorithm: (cert.signatureAlgorithm as any).name || "unknown",
		};
	} catch (error) {
		throw new Error(`Failed to validate X509 certificate: ${error}`);
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
				let metadata;
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
 * Server-side key management functions for Git commit verification
 */

/**
 * Import SSH key to server's allowed_signers file for Git signature verification
 * @param publicKey - SSH public key content
 * @param identity - Identity/address associated with the key
 * @returns Promise<boolean> - Success status
 */
export async function importSSHKeyToServer(
	publicKey: string,
	identity: string,
): Promise<boolean> {
	try {
		const fs = await import("fs/promises");
		const path = await import("path");

		// Ensure SSH directory exists
		const sshDir = path.join(process.env.HOME || "/tmp", ".ssh");
		await fs.mkdir(sshDir, { recursive: true, mode: 0o700 });

		const allowedSignersFile = path.join(sshDir, "allowed_signers");

		// Normalize SSH key format
		let formattedKey = publicKey.trim();
		if (!formattedKey.startsWith("ssh-")) {
			// Assume it's just the key material and prepend ssh-ed25519
			formattedKey = `ssh-ed25519 ${formattedKey}`;
		}

		// Format: identity key_type key_material
		const signerEntry = `${identity} ${formattedKey}\n`;

		// Check if entry already exists
		try {
			const existingContent = await fs.readFile(allowedSignersFile, "utf-8");
			if (existingContent.includes(signerEntry.trim())) {
				console.log(
					`SSH key for ${identity} already exists in allowed_signers`,
				);
				return true;
			}
		} catch (error) {
			// File doesn't exist yet, which is fine
		}

		// Append to allowed signers file
		await fs.appendFile(allowedSignersFile, signerEntry);

		// Set proper permissions
		await fs.chmod(allowedSignersFile, 0o600);

		console.log(
			`✅ SSH key imported to allowed_signers for identity: ${identity}`,
		);
		return true;
	} catch (error) {
		console.error("❌ Failed to import SSH key to server:", error);
		return false;
	}
}

/**
 * Import GPG key to server's keyring for Git signature verification
 * @param publicKey - GPG public key in armored format
 * @param identity - Identity/address associated with the key
 * @returns Promise<boolean> - Success status
 */
export async function importGPGKeyToServer(
	publicKey: string,
	identity: string,
): Promise<boolean> {
	try {
		const fs = await import("fs/promises");
		const path = await import("path");
		const { exec } = await import("child_process");
		const { promisify } = await import("util");
		const execAsync = promisify(exec);

		// Validate the PGP key first
		try {
			const openpgp = await import("openpgp");
			const key = await openpgp.readKey({ armoredKey: publicKey });
			const fingerprint = key.getFingerprint();

			// Check if key is already imported
			const isImported = await isGPGKeyImported(fingerprint);
			if (isImported) {
				console.log(`✅ GPG key already imported for identity: ${identity}`);
				return true;
			}
		} catch (validationError) {
			console.error("❌ Invalid PGP key format:", validationError);
			return false;
		}

		// Create temporary file for the key
		const tempDir = "/tmp";
		const tempKeyFile = path.join(
			tempDir,
			`gpg-key-${identity}-${Date.now()}.asc`,
		);

		await fs.writeFile(tempKeyFile, publicKey);

		try {
			// Import to GPG keyring with batch mode for non-interactive operation
			const importCommand = `gpg --batch --import "${tempKeyFile}"`;
			const { stdout, stderr } = await execAsync(importCommand, {
				timeout: 30000,
				env: {
					...process.env,
					GNUPGHOME: process.env.GNUPGHOME || `${process.env.HOME}/.gnupg`,
				},
			});

			console.log(`✅ GPG key imported for identity: ${identity}`);
			if (stdout) console.log("GPG import output:", stdout);
			if (
				stderr &&
				!stderr.includes("unchanged") &&
				!stderr.includes("not changed")
			) {
				console.warn("GPG import warnings:", stderr);
			}

			// Set trust level for verification (non-interactive)
			try {
				const openpgp = await import("openpgp");
				const key = await openpgp.readKey({ armoredKey: publicKey });
				const fingerprint = key.getFingerprint();

				// Set trust to full for verification purposes
				const trustCommand = `echo "${fingerprint}:6:" | gpg --batch --import-ownertrust`;
				await execAsync(trustCommand, { timeout: 10000 });
				console.log(`✅ Trust level set for key: ${fingerprint}`);
			} catch (trustError) {
				console.warn("⚠️ Could not set trust level for GPG key:", trustError);
				// This is not critical for verification, so we continue
			}

			return true;
		} finally {
			// Clean up temporary file
			try {
				await fs.unlink(tempKeyFile);
			} catch (cleanupError) {
				console.warn("Failed to cleanup temp GPG key file:", cleanupError);
			}
		}
	} catch (error) {
		console.error("❌ Failed to import GPG key to server:", error);
		return false;
	}
}

/**
 * Remove SSH key from server's allowed_signers file
 * @param identity - Identity/address to remove
 * @returns Promise<boolean> - Success status
 */
export async function removeSSHKeyFromServer(
	identity: string,
): Promise<boolean> {
	try {
		const fs = await import("fs/promises");
		const path = await import("path");

		const sshDir = path.join(process.env.HOME || "/tmp", ".ssh");
		const allowedSignersFile = path.join(sshDir, "allowed_signers");

		try {
			const content = await fs.readFile(allowedSignersFile, "utf-8");
			const lines = content.split("\n");
			const filteredLines = lines.filter(
				(line) => !line.startsWith(`${identity} `),
			);

			await fs.writeFile(allowedSignersFile, filteredLines.join("\n"));
			console.log(
				`✅ SSH key removed from allowed_signers for identity: ${identity}`,
			);
			return true;
		} catch (error) {
			if ((error as any).code === "ENOENT") {
				console.log("allowed_signers file does not exist");
				return true;
			}
			throw error;
		}
	} catch (error) {
		console.error("❌ Failed to remove SSH key from server:", error);
		return false;
	}
}

/**
 * Remove GPG key from server's keyring
 * @param identity - Identity/address associated with the key
 * @param keyFingerprint - GPG key fingerprint (optional, for more precise removal)
 * @returns Promise<boolean> - Success status
 */
export async function removeGPGKeyFromServer(
	identity: string,
	keyFingerprint?: string,
): Promise<boolean> {
	try {
		const { exec } = await import("child_process");
		const { promisify } = await import("util");
		const execAsync = promisify(exec);

		if (keyFingerprint) {
			// Remove by fingerprint (more precise)
			const { stdout, stderr } = await execAsync(
				`gpg --delete-keys --batch --yes ${keyFingerprint}`,
				{
					timeout: 30000,
				},
			);

			console.log(`✅ GPG key removed by fingerprint: ${keyFingerprint}`);
			if (stderr) console.warn("GPG removal warnings:", stderr);
		} else {
			// List keys and remove by identity (less precise)
			console.warn(
				`⚠️ Removing GPG keys by identity ${identity} - this may remove multiple keys`,
			);

			try {
				const listResult = await execAsync(
					`gpg --list-keys --with-colons | grep "${identity}"`,
					{ timeout: 10000 },
				);
				if (listResult.stdout) {
					console.log(
						"Found GPG keys for identity, manual removal may be needed",
					);
				}
			} catch (listError) {
				console.log("No GPG keys found for identity");
			}
		}

		return true;
	} catch (error) {
		console.error("❌ Failed to remove GPG key from server:", error);
		return false;
	}
}

/**
 * Check if SSH key is already imported to server
 * @param identity - Identity/address to check
 * @returns Promise<boolean> - True if key exists
 */
export async function isSSHKeyImported(identity: string): Promise<boolean> {
	try {
		const fs = await import("fs/promises");
		const path = await import("path");

		const sshDir = path.join(process.env.HOME || "/tmp", ".ssh");
		const allowedSignersFile = path.join(sshDir, "allowed_signers");

		try {
			const content = await fs.readFile(allowedSignersFile, "utf-8");
			return content.includes(`${identity} `);
		} catch (error) {
			if ((error as any).code === "ENOENT") {
				return false;
			}
			throw error;
		}
	} catch (error) {
		console.error("❌ Failed to check SSH key import status:", error);
		return false;
	}
}

/**
 * Check if GPG key is already imported to server
 * @param keyFingerprint - GPG key fingerprint or identity
 * @returns Promise<boolean> - True if key exists
 */
export async function isGPGKeyImported(
	keyFingerprint: string,
): Promise<boolean> {
	try {
		const { exec } = await import("child_process");
		const { promisify } = await import("util");
		const execAsync = promisify(exec);

		const { stdout } = await execAsync(`gpg --list-keys "${keyFingerprint}"`, {
			timeout: 10000,
		});

		return stdout.includes("pub ") || stdout.includes("uid ");
	} catch (error) {
		// gpg --list-keys exits with non-zero code if key not found
		return false;
	}
}

/**
 * Initialize server environment for Git signature verification
 * @returns Promise<boolean> - Success status
 */
export async function initializeServerGitEnvironment(): Promise<boolean> {
	try {
		const fs = await import("fs/promises");
		const path = await import("path");
		const { exec } = await import("child_process");
		const { promisify } = await import("util");
		const execAsync = promisify(exec);

		console.log("Initializing server Git environment...");

		// Create SSH directory with proper permissions
		const sshDir = path.join(process.env.HOME || "/tmp", ".ssh");
		await fs.mkdir(sshDir, { recursive: true, mode: 0o700 });

		// Create allowed_signers file if it doesn't exist
		const allowedSignersFile = path.join(sshDir, "allowed_signers");
		try {
			await fs.access(allowedSignersFile);
		} catch {
			await fs.writeFile(
				allowedSignersFile,
				"# Git SSH signature verification\n# Format: identity ssh-keytype keydata\n",
			);
			await fs.chmod(allowedSignersFile, 0o600);
		}

		// Configure Git for signature verification
		const gitConfigs = [
			["log.showSignature", "true"],
			["merge.verifySignatures", "false"], // Don't require signatures for merge
			["receive.fsckObjects", "true"],
		];

		for (const [key, value] of gitConfigs) {
			try {
				await execAsync(`git config --global ${key} ${value}`, {
					timeout: 5000,
				});
			} catch (error) {
				console.warn(`Failed to set git config ${key}:`, error);
			}
		}

		// Test GPG availability
		try {
			await execAsync("gpg --version", { timeout: 5000 });
			console.log("GPG is available");
		} catch (error) {
			console.warn(
				"⚠️ GPG is not available, GPG signature verification will be disabled",
			);
		}

		// Test SSH keygen availability
		try {
			await execAsync("ssh -V", { timeout: 5000 });
			console.log("SSH tools are available");
		} catch (error) {
			console.warn(
				"⚠️ SSH tools are not available, SSH signature verification may be limited",
			);
		}

		console.log("Server Git environment initialized");
		return true;
	} catch (error) {
		console.error("❌ Failed to initialize server Git environment:", error);
		return false;
	}
}

/**
 * Get server Git verification capabilities
 * @returns Promise<{ssh: boolean, gpg: boolean, git: boolean}> - Available capabilities
 */
export async function getServerGitCapabilities(): Promise<{
	ssh: boolean;
	gpg: boolean;
	git: boolean;
}> {
	const { exec } = await import("child_process");
	const { promisify } = await import("util");
	const execAsync = promisify(exec);

	const capabilities = {
		ssh: false,
		gpg: false,
		git: false,
	};

	// Test Git
	try {
		await execAsync("git --version", { timeout: 5000 });
		capabilities.git = true;
	} catch (error) {
		console.warn("Git is not available");
	}

	// Test GPG
	try {
		await execAsync("gpg --version", { timeout: 5000 });
		capabilities.gpg = true;
	} catch (error) {
		console.warn("GPG is not available");
	}

	// Test SSH
	try {
		await execAsync("ssh -V", { timeout: 5000 });
		capabilities.ssh = true;
	} catch (error) {
		console.warn("SSH tools are not available");
	}

	return capabilities;
}

/**
 * PGP Key Registration Workflow Helpers
 */

/**
 * Generate PGP signature for key registration
 * @param message - Message to sign (usually "[eth_address] [nonce]")
 * @param privateKeyArmored - PGP private key in armored format
 * @param passphrase - Private key passphrase (optional)
 * @returns Promise<string> - Armored signature
 */
export async function generatePGPSignature(
	message: string,
	privateKeyArmored: string,
	passphrase?: string,
): Promise<string> {
	try {
		const privateKey = await openpgp.readPrivateKey({
			armoredKey: privateKeyArmored,
		});

		// Decrypt the private key if passphrase is provided
		const decryptedKey = passphrase
			? await openpgp.decryptKey({ privateKey, passphrase })
			: privateKey;

		// Create signature
		const unsignedMessage = await openpgp.createCleartextMessage({
			text: message,
		});
		const cleartextMessage = await openpgp.sign({
			message: unsignedMessage,
			signingKeys: decryptedKey,
			format: "armored",
		});

		return cleartextMessage as string;
	} catch (error) {
		throw new Error(`Failed to generate PGP signature: ${error}`);
	}
}

/**
 * Verify PGP signature for key registration
 * @param signature - Armored PGP signature
 * @param publicKeyArmored - PGP public key in armored format
 * @returns Promise<{verified: boolean, message: string}> - Verification result
 */
export async function verifyPGPSignature(
	signature: string,
	publicKeyArmored: string,
): Promise<{ verified: boolean; message: string }> {
	try {
		const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });

		// Verify the signature
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
 * Prepare PGP key for blockchain registration
 * @param publicKeyArmored - PGP public key in armored format
 * @param ethereumAddress - Ethereum address to associate
 * @param nonce - Unique nonce for registration
 * @returns Promise<{keyMaterial: string, fullKey: string, fingerprint: string, keyId: string}>
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
		// Extract key material for blockchain storage
		const keyMaterial = await extractPGPKeyMaterial(publicKeyArmored);

		// Generate fingerprint for verification
		const fingerprint = await generatePGPKeyFingerprint(publicKeyArmored);

		// Get key ID
		const key = await openpgp.readKey({ armoredKey: publicKeyArmored });
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
