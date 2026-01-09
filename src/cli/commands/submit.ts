import chalk from "chalk";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import * as readline from "readline/promises";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { CommitAlgo } from "../../clients/commitObligation.js";
import { detectFramework } from "../../test-execution/frameworkDetection.js";
import { cloneGitRepository } from "../../test-execution/utils.js";
import { createClientFromEnv, requireEnvFile } from "../utils/envLoader.js";

interface SubmitOptions {
	testsRepo: string;
	testsCommit: string;
	reward: string;
	testsCommand?: string;
	testsAlgo?: string;
	arbiter?: string;
	oracle?: string;
	token?: string;
}

export async function submitCommand(options: SubmitOptions) {
	try {
		console.log(chalk.blue("Creating new escrow demand..."));

		// Validate inputs
		if (!options.testsRepo || !options.testsCommit || !options.reward) {
			throw new Error(
				"Missing required options: --tests-repo, --tests-commit, --reward",
			);
		}

		// Step 1: Clone test repo to detect framework
		console.log(chalk.cyan("Cloning test repository to detect framework..."));
		const tmpDir = path.join(os.tmpdir(), `git-test-detect-${Date.now()}`);
		await fs.mkdir(tmpDir, { recursive: true });
		const testRepoPath = path.join(tmpDir, "test-repo");

		try {
			await cloneGitRepository(
				options.testsRepo,
				testRepoPath,
				options.testsCommit,
			);

			let isCustom = false;

			// Priority 1: Check if arkhai_tests.dockerfile exists in the test repo
			const repoDockerfilePath = path.join(
				testRepoPath,
				"arkhai_tests.dockerfile",
			);
			let dockerfileContent: string;
			let frameworkName: string;

			try {
				await fs.access(repoDockerfilePath);
				isCustom = true;
				dockerfileContent = await fs.readFile(repoDockerfilePath, "utf-8");
				frameworkName = "custom";
				console.log(chalk.cyan("Found arkhai_tests.dockerfile in repository"));
			} catch (error) {
				// Priority 2: Detect framework and use default dockerfile content
				console.log(
					chalk.cyan(
						"No custom dockerfile found, detecting project framework...",
					),
				);
				const frameworkResult = await detectFramework(testRepoPath);
				dockerfileContent = frameworkResult.dockerfileContent;
				frameworkName = frameworkResult.framework.name;
				console.log(
					chalk.green(
						`\nYour repo was detected as a ${chalk.bold(frameworkName)} project.`,
					),
				);
			}

			console.log(chalk.white(`\nTests will be run via:\n`));
			console.log(chalk.gray("---"));
			console.log(chalk.cyan(dockerfileContent));
			console.log(chalk.gray("---\n"));

			console.log(
				chalk.gray(
					'💡 To use a custom dockerfile, create "arkhai_tests.dockerfile" in your test repository\n',
				),
			);
			console.log(chalk.green("✅ Proceeding with escrow creation...\n"));
		} finally {
			// Cleanup temp directory
			await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
		}

		// Parse commit algorithm
		const commitAlgoMap: Record<string, number> = {
			sha1: CommitAlgo.SHA256, // Note: using SHA256 as default based on test
			sha256: CommitAlgo.SHA256,
			md5: CommitAlgo.MD5,
		};

		const testsAlgo = commitAlgoMap[options.testsAlgo?.toLowerCase() || "sha1"];
		if (testsAlgo === undefined) {
			throw new Error(
				`Invalid commit algorithm: ${options.testsAlgo}. Use: sha1, sha256, or md5`,
			);
		}

		// Check for .env file and load client
		requireEnvFile();

		console.log(chalk.gray("Setting up blockchain client..."));
		const { client, config, hasCommitObligation } = await createClientFromEnv();

		if (!hasCommitObligation) {
			throw new Error(
				"COMMIT_OBLIGATION_ADDRESS is required in .env file for this command",
			);
		}

		// Require explicit addresses when using environment configuration
		if (!options.arbiter || !options.oracle || !options.token) {
			throw new Error(
				"You must provide --arbiter, --oracle, and --token addresses when using environment configuration",
			);
		}

		// Normalize addresses to lowercase to avoid checksum case mismatches
		const arbiterAddress = options.arbiter.toLowerCase();
		const oracleAddress = options.oracle.toLowerCase();
		const tokenAddress = options.token.toLowerCase();

		// Encode the demand data
		const encodeCommitTestsDemand = (demand: {
			testsCommitHash: string;
			testsCommand: string;
			testsCommitAlgo: number;
			hosts: string[];
		}) => {
			return encodeAbiParameters(
				parseAbiParameters(
					"(string testsCommitHash, string testsCommand, uint8 testsCommitAlgo, string[] hosts)",
				),
				[demand],
			);
		};

		const commitTestsData = encodeCommitTestsDemand({
			testsCommitHash: options.testsCommit,
			testsCommand: options.testsCommand || "npm test",
			testsCommitAlgo: testsAlgo,
			hosts: [options.testsRepo],
		});

		console.log(chalk.gray("Encoding demand with data:"));
		console.log(chalk.gray(`  Tests Repo: ${options.testsRepo}`));
		console.log(chalk.gray(`  Tests Commit: ${options.testsCommit}`));
		console.log(
			chalk.gray(`  Tests Command: ${options.testsCommand || "npm test"}`),
		);
		console.log(
			chalk.gray(`  Commit Algorithm: ${options.testsAlgo || "sha1"}`),
		);

		// Create the trusted oracle demand
		const demand = client.arbiters.encodeTrustedOracleDemand({
			oracle: oracleAddress,
			data: commitTestsData,
		});

		console.log(chalk.gray("Creating escrow with demand..."));

		// Create the escrow by depositing tokens
		const rewardAmount = BigInt(options.reward);
		let escrow;

		try {
			// Try with permit first (EIP-2612)
			console.log(chalk.gray("Attempting to use EIP-2612 permit..."));
			const result = await client.erc20.permitAndBuyWithErc20(
				{
					address: tokenAddress,
					value: rewardAmount,
				},
				{ arbiter: arbiterAddress, demand },
				0n,
			);
			escrow = result.attested;
			console.log(chalk.green("✓ Used EIP-2612 permit"));
		} catch (permitError: any) {
			// If permit fails, fallback to approve + transfer
			console.log(
				chalk.yellow(
					"EIP-2612 permit not supported, falling back to approve + transfer",
				),
			);

			// Check current allowance to avoid unnecessary approval
			console.log(chalk.gray("Checking current token allowance..."));
			// The spender is the ERC20EscrowObligation contract, not the CommitObligation contract
			const escrowAddress = client.contractAddresses.erc20EscrowObligation;
			if (!escrowAddress) {
				throw new Error("ERC20EscrowObligation address not found in client");
			}

			console.log(chalk.gray(`  Owner: ${config.address}`));
			console.log(
				chalk.gray(`  Spender (ERC20EscrowObligation): ${escrowAddress}`),
			);

			const currentAllowance = await client.viemClient.readContract({
				address: tokenAddress as `0x${string}`,
				abi: [
					{
						name: "allowance",
						type: "function",
						stateMutability: "view",
						inputs: [
							{ name: "owner", type: "address" },
							{ name: "spender", type: "address" },
						],
						outputs: [{ type: "uint256" }],
					},
				],
				functionName: "allowance",
				args: [config.address as `0x${string}`, escrowAddress as `0x${string}`],
			});

			let approveHash;
			if (currentAllowance >= rewardAmount) {
				console.log(
					chalk.green(
						`✓ Sufficient allowance already exists (${currentAllowance} >= ${rewardAmount})`,
					),
				);
				console.log(chalk.gray("Skipping approval step..."));
			} else {
				console.log(
					chalk.gray(
						`Current allowance: ${currentAllowance}, approving ${rewardAmount}...`,
					),
				);

				// First approve the tokens
				approveHash = await client.erc20.approve(
					{
						address: tokenAddress,
						value: rewardAmount,
					},
					"escrow",
				);

				console.log(chalk.gray(`Approval tx: ${approveHash}`));

				// Debug: Get transaction details to see what nonce was used
				try {
					const tx = await client.viemClient.getTransaction({
						hash: approveHash,
					});
					console.log(chalk.yellow(`Transaction nonce used: ${tx.nonce}`));
				} catch (txError) {
					console.log(
						chalk.yellow(
							`Could not fetch transaction details: ${txError instanceof Error ? txError.message : String(txError)}`,
						),
					);
				}

				console.log(chalk.gray("Confirming approval..."));

				try {
					// Wait for the approval transaction to be confirmed with longer timeout for Base Sepolia
					await client.viemClient.waitForTransactionReceipt({
						hash: approveHash,
						timeout: 180_000, // 3 minutes timeout for Base Sepolia
					});
					console.log(chalk.green("✓ Approval confirmed"));
				} catch (error) {
					// If approval confirmation times out or fails, we MUST NOT proceed
					// because the buyWithErc20 will fail without approval
					console.log(chalk.red("❌ Approval transaction failed or timed out"));
					console.log(
						chalk.yellow(
							"Cannot proceed with escrow creation without confirmed approval",
						),
					);
					console.log(
						chalk.gray(`Check transaction status: with tx ${approveHash}`),
					);
					throw new Error(
						"Approval transaction failed or timed out. Please check BaseScan and retry.",
					);
				}
			}

			// Now create the escrow
			// TODO: Remove this workaround when migrating to new SDK with permitAnd_ functions
			await new Promise((resolve) => setTimeout(resolve, 5000));
			console.log(chalk.gray("Creating escrow..."));
			try {
				const result = await client.erc20.buyWithErc20(
					{
						address: tokenAddress,
						value: rewardAmount,
					},
					{ arbiter: arbiterAddress, demand },
					0n,
				);
				escrow = result.attested;
				console.log(chalk.green("✓ Used approve + transfer"));
			} catch (buyError: any) {
				console.log(chalk.red("❌ Failed to create escrow"));
				console.log(chalk.yellow("Error details:"));
				console.log(
					chalk.gray(
						buyError instanceof Error ? buyError.message : String(buyError),
					),
				);

				// Check if it's a contract revert error
				if (buyError.message?.includes("ERC20TransferFailed")) {
					console.log(chalk.yellow("\nPossible causes:"));
					console.log(chalk.gray("  1. Insufficient token balance"));
					console.log(
						chalk.gray("  2. Approval not confirmed yet (blockchain delay)"),
					);
					console.log(chalk.gray("  3. Token transfer restrictions"));
					console.log(chalk.yellow("Please try again in a few minutes"));
				}

				throw new Error("Escrow creation failed. See error details above.");
			}
		}

		console.log(chalk.green("Escrow created successfully!"));
		console.log(chalk.white("Escrow Details:"));
		console.log(chalk.gray(`  Escrow UID: ${escrow.uid}`));
		console.log(chalk.gray(`  Attester: ${escrow.attester}`));
		console.log(chalk.gray(`  Recipient: ${escrow.recipient}`));
		console.log(chalk.gray(`  Schema UID: ${escrow.schema}`));
		console.log(chalk.gray(`  Reward: ${rewardAmount} tokens`));
		console.log(chalk.gray(`  Token: ${tokenAddress}`));
		console.log(chalk.gray(`  Oracle: ${oracleAddress}`));
		console.log(chalk.gray(`  Arbiter: ${arbiterAddress}`));

		console.log(chalk.yellow("\nNext steps:"));
		console.log(chalk.yellow("  1. Share the Escrow UID with developers"));
		console.log(
			chalk.yellow(
				"  2. Developers can fulfill using: git-escrows fulfill --escrow-uid " +
					escrow.uid +
					' --solution-repo "https://git.repo" --solution-algo "sha1" --solution-commit "developer-commit-hash"',
			),
		);

		// Exit successfully
		process.exit(0);
	} catch (error) {
		console.error(chalk.red("Failed to create escrow:"));
		console.error(
			chalk.red(error instanceof Error ? error.message : String(error)),
		);
		process.exit(1);
	}
}
