/**
 * Git server key management functions for commit signature verification
 */
import { exec } from "child_process";
import fs from "fs/promises";
import * as openpgp from "openpgp";
import path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

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
		// Validate the PGP key first
		try {
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
		if (keyFingerprint) {
			// Remove by fingerprint (more precise)
			const { stderr } = await execAsync(
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
