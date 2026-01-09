import chalk from "chalk";
import { exec, spawn } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface ServerConfig {
	pollingInterval?: number;
	timeout?: number;
	skipKeyVerification?: boolean;
	useGitVerifyCommit?: boolean;
	past?: boolean;
	listen?: boolean;
}

export interface BlockchainStatus {
	isRunning: boolean;
	blockNumber?: number;
	chainId?: number;
	url: string;
}

export class IntegrationTestHelpers {
	/**
	 * Check if local Hardhat node is running
	 */
	static async checkBlockchainStatus(
		rpcUrl: string = "http://127.0.0.1:8545",
	): Promise<BlockchainStatus> {
		try {
			const response = await fetch(rpcUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					method: "eth_blockNumber",
					params: [],
					id: 1,
				}),
			});

			if (!response.ok) {
				return { isRunning: false, url: rpcUrl };
			}

			const data = await response.json();
			const blockNumber = parseInt(data.result, 16);

			// Get chain ID
			const chainResponse = await fetch(rpcUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					method: "eth_chainId",
					params: [],
					id: 2,
				}),
			});

			const chainData = await chainResponse.json();
			const chainId = parseInt(chainData.result, 16);

			return {
				isRunning: true,
				blockNumber,
				chainId,
				url: rpcUrl,
			};
		} catch (error) {
			return { isRunning: false, url: rpcUrl };
		}
	}

	/**
	 * Wait for blockchain to be ready
	 */
	static async waitForBlockchain(
		rpcUrl: string = "http://127.0.0.1:8545",
		maxWaitMs: number = 30000,
		checkIntervalMs: number = 1000,
	): Promise<BlockchainStatus> {
		const startTime = Date.now();

		console.log(chalk.yellow(`⏳ Waiting for blockchain at ${rpcUrl}...`));

		while (Date.now() - startTime < maxWaitMs) {
			const status = await IntegrationTestHelpers.checkBlockchainStatus(rpcUrl);

			if (status.isRunning) {
				console.log(
					chalk.green(
						`✅ Blockchain ready - Block: ${status.blockNumber}, Chain ID: ${status.chainId}`,
					),
				);
				return status;
			}

			await new Promise((resolve) => setTimeout(resolve, checkIntervalMs));
		}

		throw new Error(
			`Blockchain not ready after ${maxWaitMs}ms. Make sure to run: npx hardhat node`,
		);
	}

	/**
	 * Start oracle server programmatically
	 */
	static async startOracleServer(
		config: ServerConfig = {},
		envPath: string = ".env",
	): Promise<{ process: any; stop: () => Promise<void> }> {
		return new Promise((resolve, reject) => {
			const args = [
				"tsx",
				"src/cli/index.ts",
				"server",
				"--listen",
				`--polling-interval=${config.pollingInterval || 1000}`,
				`--timeout=${config.timeout || 300000}`,
			];

			if (config.skipKeyVerification) {
				args.push("--skip-key-verification");
			}

			if (!config.useGitVerifyCommit) {
				args.push("--no-git-verify-commit");
			}

			console.log(chalk.yellow("🚀 Starting oracle server..."));
			console.log(chalk.gray(`   Command: ${args.join(" ")}`));

			const serverProcess = spawn("bun", args, {
				stdio: ["pipe", "pipe", "pipe"],
				env: { ...process.env, NODE_ENV: "test" },
			});

			let serverReady = false;
			let serverOutput = "";

			serverProcess.stdout?.on("data", (data) => {
				const output = data.toString();
				serverOutput += output;

				console.log(chalk.gray(`[SERVER] ${output.trim()}`));

				// Check for server ready indicators
				if (
					output.includes("Listening for new obligations") ||
					output.includes("Git verification service initialized")
				) {
					if (!serverReady) {
						serverReady = true;
						console.log(chalk.green("✅ Oracle server is ready"));
						resolve({
							process: serverProcess,
							stop: async () => {
								console.log(chalk.yellow("🛑 Stopping oracle server..."));
								serverProcess.kill("SIGTERM");
								await new Promise((resolve) => {
									serverProcess.on("exit", resolve);
									setTimeout(() => {
										serverProcess.kill("SIGKILL");
										resolve(null);
									}, 5000);
								});
								console.log(chalk.green("✅ Oracle server stopped"));
							},
						});
					}
				}
			});

			serverProcess.stderr?.on("data", (data) => {
				const error = data.toString();
				console.log(chalk.red(`[SERVER ERROR] ${error.trim()}`));

				if (
					error.includes("EADDRINUSE") ||
					error.includes("Failed to start server")
				) {
					reject(new Error(`Failed to start oracle server: ${error}`));
				}
			});

			serverProcess.on("error", (error) => {
				reject(new Error(`Failed to spawn oracle server: ${error.message}`));
			});

			serverProcess.on("exit", (code) => {
				if (code !== 0 && !serverReady) {
					reject(
						new Error(
							`Oracle server exited with code ${code}. Output: ${serverOutput}`,
						),
					);
				}
			});

			// Timeout if server doesn't start
			setTimeout(() => {
				if (!serverReady) {
					serverProcess.kill("SIGTERM");
					reject(
						new Error(
							`Oracle server failed to start within 30 seconds. Output: ${serverOutput}`,
						),
					);
				}
			}, 30000);
		});
	}

	/**
	 * Check if required tools are available
	 */
	static async checkDependencies(): Promise<{ [tool: string]: boolean }> {
		const tools = ["git", "gpg", "ssh-keygen", "bun", "npx"];
		const results: { [tool: string]: boolean } = {};

		for (const tool of tools) {
			try {
				await execAsync(`which ${tool}`);
				results[tool] = true;
			} catch {
				results[tool] = false;
			}
		}

		return results;
	}

	/**
	 * Validate Git configuration for signing
	 */
	static async validateGitConfig(): Promise<{
		hasPGPKey: boolean;
		hasSSHKey: boolean;
		gpgSigningEnabled: boolean;
		sshSigningEnabled: boolean;
		errors: string[];
	}> {
		const errors: string[] = [];
		let hasPGPKey = false;
		let hasSSHKey = false;
		let gpgSigningEnabled = false;
		let sshSigningEnabled = false;

		try {
			// Check GPG configuration
			try {
				const { stdout } = await execAsync("git config user.signingkey");
				if (stdout.trim()) {
					hasPGPKey = true;
				}
			} catch {
				// No GPG signing key configured
			}

			try {
				const { stdout } = await execAsync("git config commit.gpgsign");
				gpgSigningEnabled = stdout.trim() === "true";
			} catch {
				// GPG signing not enabled
			}

			// Check SSH configuration
			try {
				const { stdout } = await execAsync("git config gpg.format");
				if (stdout.trim() === "ssh") {
					const { stdout: sshKey } = await execAsync(
						"git config user.signingkey",
					);
					if (sshKey.trim()) {
						hasSSHKey = true;
						sshSigningEnabled = gpgSigningEnabled; // Same config controls both
					}
				}
			} catch {
				// SSH signing not configured
			}
		} catch (error) {
			errors.push(`Git configuration check failed: ${error}`);
		}

		return {
			hasPGPKey,
			hasSSHKey,
			gpgSigningEnabled,
			sshSigningEnabled,
			errors,
		};
	}

	/**
	 * Create a test commit in a repository
	 */
	static async createTestCommit(
		repoPath: string,
		message: string = "Integration test commit",
		signCommit: boolean = true,
	): Promise<string> {
		try {
			// Add a simple change
			const timestamp = new Date().toISOString();
			await execAsync(`echo "Test change at ${timestamp}" >> README.md`, {
				cwd: repoPath,
			});
			await execAsync("git add README.md", { cwd: repoPath });

			// Commit with or without signing
			const commitCmd = signCommit
				? `git commit -S -m "${message}"`
				: `git commit -m "${message}"`;

			await execAsync(commitCmd, { cwd: repoPath });

			// Get the commit hash
			const { stdout } = await execAsync("git rev-parse HEAD", {
				cwd: repoPath,
			});
			return stdout.trim();
		} catch (error) {
			throw new Error(`Failed to create test commit: ${error}`);
		}
	}

	/**
	 * Verify a commit signature
	 */
	static async verifyCommitSignature(
		repoPath: string,
		commitHash: string,
	): Promise<{
		isValid: boolean;
		signatureType: "gpg" | "ssh" | "none";
		signer?: string;
		error?: string;
	}> {
		try {
			// Try GPG verification first
			try {
				const { stdout } = await execAsync(`git verify-commit ${commitHash}`, {
					cwd: repoPath,
				});
				return {
					isValid: true,
					signatureType: "gpg",
					signer: stdout.trim(),
				};
			} catch (gpgError) {
				// Try SSH verification
				try {
					const { stdout } = await execAsync(
						`git log --show-signature -1 ${commitHash}`,
						{ cwd: repoPath },
					);
					if (stdout.includes("Good signature")) {
						return {
							isValid: true,
							signatureType: "ssh",
							signer: "SSH signature detected",
						};
					}
				} catch (sshError) {
					// No valid signature found
				}
			}

			return {
				isValid: false,
				signatureType: "none",
				error: "No valid signature found",
			};
		} catch (error) {
			return {
				isValid: false,
				signatureType: "none",
				error: `Verification failed: ${error}`,
			};
		}
	}

	/**
	 * Clean up test artifacts
	 */
	static async cleanup(paths: string[]): Promise<void> {
		for (const path of paths) {
			try {
				await execAsync(`rm -rf "${path}"`);
				console.log(chalk.green(`✅ Cleaned up: ${path}`));
			} catch (error) {
				console.log(chalk.yellow(`⚠️ Could not clean up ${path}: ${error}`));
			}
		}
	}

	/**
	 * Print system information for debugging
	 */
	static async printSystemInfo(): Promise<void> {
		console.log(chalk.blue("\n🔧 System Information"));

		const deps = await IntegrationTestHelpers.checkDependencies();
		for (const [tool, available] of Object.entries(deps)) {
			const status = available ? chalk.green("✅") : chalk.red("❌");
			console.log(`   ${status} ${tool}`);
		}

		const gitConfig = await IntegrationTestHelpers.validateGitConfig();
		console.log(chalk.blue("\n🔧 Git Configuration"));
		console.log(`   ${gitConfig.hasPGPKey ? "✅" : "❌"} PGP Key configured`);
		console.log(`   ${gitConfig.hasSSHKey ? "✅" : "❌"} SSH Key configured`);
		console.log(
			`   ${gitConfig.gpgSigningEnabled ? "✅" : "❌"} Commit signing enabled`,
		);

		if (gitConfig.errors.length > 0) {
			console.log(chalk.red("\n⚠️ Git Configuration Issues:"));
			gitConfig.errors.forEach((error) =>
				console.log(chalk.red(`   • ${error}`)),
			);
		}
	}
}

export default IntegrationTestHelpers;
