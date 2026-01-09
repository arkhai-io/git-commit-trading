/**
 * Git commit signature verification
 */
import { exec } from "child_process";
import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import { KeyType } from "../clients/gitIdentityRegistry.js";

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Verify that a commit in a repository was signed by the given public key.
 *
 * @param repoDir - Path to the cloned repository
 * @param commitHash - Commit hash to verify
 * @param keyType - Type of the key (SSH, GPG, etc.)
 * @param publicKey - Public key material to verify against
 * @param timeoutMs - Timeout for git commands (default: 30000)
 * @returns true if the commit is signed by the given key, false otherwise
 */
export async function verifyRepo(
	repoDir: string,
	commitHash: string,
	keyType: KeyType,
	publicKey: string,
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<boolean> {
	try {
		// Get commit signature info
		const signatureInfo = await getCommitSignature(
			repoDir,
			commitHash,
			timeoutMs,
		);

		if (!signatureInfo.hasSignature) {
			console.log("❌ Commit is not signed");
			return false;
		}

		// Check signature type matches key type
		const expectedSigType = getSignatureTypeForKeyType(keyType);
		if (signatureInfo.signatureType !== expectedSigType) {
			console.log(
				`❌ Signature type mismatch: expected ${expectedSigType}, got ${signatureInfo.signatureType}`,
			);
			return false;
		}

		// Configure git for verification and run git verify-commit
		await configureGitForKey(repoDir, keyType, publicKey);
		const verifyResult = await runGitVerifyCommit(
			repoDir,
			commitHash,
			timeoutMs,
		);

		if (!verifyResult.success) {
			console.log("❌ git verify-commit failed");
			return false;
		}

		// Match the signature against the provided key
		const isMatch = await matchKey(
			keyType,
			publicKey,
			signatureInfo.fingerprint,
			signatureInfo.keyId,
			verifyResult.rawOutput + "\n" + verifyResult.stderr,
		);

		if (isMatch) {
			console.log("✅ Commit signature verified");
		} else {
			console.log("❌ Commit signature does not match provided key");
		}

		return isMatch;
	} catch (error) {
		console.error("❌ Error verifying repo:", error);
		return false;
	}
}

// ============================================================================
// Internal helpers
// ============================================================================

interface SignatureInfo {
	hasSignature: boolean;
	signatureType?: "gpg" | "ssh" | "x509";
	keyId?: string;
	fingerprint?: string;
}

function getSignatureTypeForKeyType(keyType: KeyType): "gpg" | "ssh" | "x509" {
	switch (keyType) {
		case KeyType.PGPv4:
			return "gpg";
		case KeyType.SSHEd25519:
		case KeyType.SSHSecp256k1:
			return "ssh";
		case KeyType.X509:
			return "x509";
		default:
			return "gpg";
	}
}

async function getCommitSignature(
	repoDir: string,
	commitHash: string,
	timeoutMs: number,
): Promise<SignatureInfo> {
	try {
		const { stdout } = await execAsync(
			`git show --show-signature --format=fuller ${commitHash}`,
			{ cwd: repoDir, timeout: timeoutMs },
		);

		const hasGpgSignature =
			stdout.includes("gpg:") || stdout.includes("Good signature");
		const hasSshSignature =
			stdout.includes('Good "git" signature') ||
			stdout.includes("with ED25519 key") ||
			stdout.includes("with RSA key") ||
			stdout.includes("with ECDSA key");

		if (hasGpgSignature) {
			const keyIdMatch = stdout.match(
				/using (?:RSA|DSA|ECDSA|EdDSA) key ([A-F0-9]+)/i,
			);
			return {
				hasSignature: true,
				signatureType: "gpg",
				keyId: keyIdMatch?.[1],
				fingerprint: keyIdMatch?.[1],
			};
		} else if (hasSshSignature) {
			const sshKeyMatch = stdout.match(
				/with ([A-Z0-9]+) key SHA256:([A-Za-z0-9+/=]+)/,
			);
			return {
				hasSignature: true,
				signatureType: "ssh",
				keyId: sshKeyMatch?.[2],
				fingerprint: sshKeyMatch?.[2],
			};
		}

		return { hasSignature: false };
	} catch (error) {
		console.warn("Failed to get commit signature info:", error);
		return { hasSignature: false };
	}
}

async function configureGitForKey(
	repoDir: string,
	keyType: KeyType,
	publicKey: string,
): Promise<void> {
	const homeDir = process.env.HOME || process.env.USERPROFILE || "/root";

	try {
		if (keyType === KeyType.SSHEd25519 || keyType === KeyType.SSHSecp256k1) {
			// Write temporary allowed_signers file with this key
			const sshDir = path.join(homeDir, ".ssh");
			await fs.mkdir(sshDir, { recursive: true, mode: 0o700 });

			const allowedSignersFile = path.join(sshDir, "allowed_signers");
			const keyPrefix =
				keyType === KeyType.SSHEd25519 ? "ssh-ed25519" : "ecdsa-sha2-nistp256";
			const signerEntry = `* ${keyPrefix} ${publicKey}\n`;

			// Append to allowed signers (or create if doesn't exist)
			await fs.appendFile(allowedSignersFile, signerEntry);

			await execAsync(
				`git config --local gpg.ssh.allowedSignersFile "${allowedSignersFile}"`,
				{
					cwd: repoDir,
					timeout: 5000,
				},
			);
		}
		// GPG keys don't need special config - git uses system GPG keyring
	} catch (error) {
		console.warn(
			"⚠️ Failed to configure Git for signature verification:",
			error,
		);
	}
}

async function runGitVerifyCommit(
	repoDir: string,
	commitHash: string,
	timeoutMs: number,
): Promise<{ success: boolean; rawOutput: string; stderr: string }> {
	try {
		const { stdout, stderr } = await execAsync(
			`git verify-commit --raw ${commitHash}`,
			{
				cwd: repoDir,
				timeout: timeoutMs,
			},
		);
		return { success: true, rawOutput: stdout, stderr };
	} catch (error: any) {
		return {
			success: false,
			rawOutput: error.stdout || "",
			stderr: error.stderr || error.message,
		};
	}
}

async function matchKey(
	keyType: KeyType,
	publicKey: string,
	fingerprint?: string,
	keyId?: string,
	gitOutput?: string,
): Promise<boolean> {
	if (!fingerprint && !keyId) {
		return false;
	}

	switch (keyType) {
		case KeyType.PGPv4:
			return matchGpgKey(publicKey, fingerprint, keyId, gitOutput);

		case KeyType.SSHEd25519:
		case KeyType.SSHSecp256k1:
			return matchSshKey(publicKey, fingerprint, keyId);

		case KeyType.X509:
			// Not implemented
			return false;

		default:
			return false;
	}
}

async function matchGpgKey(
	publicKey: string,
	fingerprint?: string,
	keyId?: string,
	gitOutput?: string,
): Promise<boolean> {
	try {
		const openpgp = await import("openpgp");

		let key;
		if (publicKey.includes("-----BEGIN PGP")) {
			key = await openpgp.readKey({ armoredKey: publicKey });
		} else {
			try {
				const keyBytes = Buffer.from(publicKey, "base64");
				key = await openpgp.readKey({ binaryKey: keyBytes });
			} catch {
				const armoredKey = `-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n${publicKey}\n-----END PGP PUBLIC KEY BLOCK-----`;
				key = await openpgp.readKey({ armoredKey });
			}
		}

		const fullFingerprint = key.getFingerprint().toUpperCase();
		const cleanStoredFingerprint = fullFingerprint.replace(/\s/g, "");

		// Try to match against fingerprint from signature
		if (fingerprint) {
			const cleanFingerprint = fingerprint.replace(/\s/g, "").toUpperCase();
			if (cleanStoredFingerprint === cleanFingerprint) return true;
			// Check short key ID (last 16 chars)
			if (cleanStoredFingerprint.slice(-16) === cleanFingerprint) return true;
		}

		// Try to match against VALIDSIG/GOODSIG from git output
		if (gitOutput) {
			const validSigMatch = gitOutput.match(/\[GNUPG:\] VALIDSIG ([A-F0-9]+)/i);
			const goodSigMatch = gitOutput.match(/\[GNUPG:\] GOODSIG ([A-F0-9]+)/i);
			const gitFingerprint = validSigMatch?.[1] || goodSigMatch?.[1];

			if (gitFingerprint) {
				const cleanGitFingerprint = gitFingerprint
					.replace(/\s/g, "")
					.toUpperCase();
				if (cleanStoredFingerprint === cleanGitFingerprint) return true;
				if (cleanStoredFingerprint.endsWith(cleanGitFingerprint)) return true;
				if (cleanGitFingerprint.endsWith(cleanStoredFingerprint.slice(-16)))
					return true;
			}
		}

		return false;
	} catch (error) {
		console.warn("⚠️ Error parsing GPG key for matching:", error);
		return false;
	}
}

function matchSshKey(
	publicKey: string,
	fingerprint?: string,
	keyId?: string,
): boolean {
	const keyMaterial = publicKey.trim();

	// Calculate SHA256 fingerprint of the key
	const calculatedFingerprint = calculateSshFingerprint(keyMaterial);

	if (
		calculatedFingerprint &&
		fingerprint &&
		calculatedFingerprint === fingerprint
	) {
		return true;
	}

	// Fallback: direct comparison
	if (keyId && keyMaterial === keyId.trim()) {
		return true;
	}

	return false;
}

function calculateSshFingerprint(sshKeyBase64: string): string {
	try {
		const keyBuffer = Buffer.from(sshKeyBase64, "base64");
		const hash = createHash("sha256")
			.update(keyBuffer)
			.digest("base64")
			.replace(/=+$/, "");
		return hash;
	} catch {
		return "";
	}
}
