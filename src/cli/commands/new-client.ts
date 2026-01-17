import chalk from "chalk";
import { existsSync, writeFileSync } from "fs";
import { nonceManager } from "viem";
import { privateKeyToAccount } from "viem/accounts";

interface NewClientOptions {
	privateKey: string;
	network: string;
	output?: string;
}

export async function newClientCommand(options: NewClientOptions) {
	try {
		console.log(
			chalk.blue("🔑 Creating .env file for client configuration..."),
		);

		// Validate inputs
		if (!options.privateKey || !options.network) {
			throw new Error("Missing required options: --privateKey, --network");
		}

		// Validate private key format
		if (
			!options.privateKey.startsWith("0x") ||
			options.privateKey.length !== 66
		) {
			throw new Error(
				"Invalid private key format. Must be 64 hex characters starting with 0x",
			);
		}

		const envFile = ".env";

		// Check if .env already exists
		if (existsSync(envFile)) {
			console.log(chalk.yellow(`.env already exists. Overwriting...`));
		}

		// Create account from private key to get the address
		const account = privateKeyToAccount(options.privateKey as `0x${string}`, {
			nonceManager,
		});

		console.log(chalk.green("✓ Account created successfully"));
		console.log(chalk.gray(`  Address: ${account.address}`));
		console.log(chalk.gray(`  Network: ${options.network}`));

		// Create .env content (address is derived from private key automatically)
		let envContent = `# Git Escrows Client Configuration
# Generated on ${new Date().toISOString()}

PRIVATE_KEY=${options.privateKey}
NETWORK=${options.network}
`;

		// Add RPC URL if not anvil/localhost
		if (
			options.network.toLowerCase() !== "anvil" &&
			options.network.toLowerCase() !== "localhost"
		) {
			envContent += `RPC_URL=# Add your RPC URL here
`;
		} else {
			envContent += `RPC_URL=http://127.0.0.1:8545
`;
		}

		// Add placeholder for commit obligation address
		envContent += `COMMIT_OBLIGATION_ADDRESS= #Add the deployed CommitObligation contract address here
GIT_IDENTITY_REGISTRY_ADDRESS= #Add the deployed GitIdentityRegistry contract address here

# Optional additional contract addresses:
# ERC20_ESCROW_OBLIGATION_ADDRESS=
# ARBITER_ADDRESS=
# ORACLE_ADDRESS=
# TOKEN_ADDRESS=
`;

		// Write .env file
		writeFileSync(envFile, envContent);

		console.log(chalk.green(`✅ .env file created successfully!`));
		console.log(chalk.yellow("\nNext steps:"));
		console.log(
			chalk.gray("1. Add the COMMIT_OBLIGATION_ADDRESS to your .env file"),
		);
		console.log(
			chalk.gray("2. Add the GIT_IDENTITY_REGISTRY_ADDRESS to your .env file"),
		);
		console.log(
			chalk.gray("3. If using a network other than anvil, add the RPC_URL"),
		);
		console.log(
			chalk.gray("4. Test your configuration with: git-escrows list"),
		);
		console.log(
			chalk.gray("5. Register your Git SSH key with: git-escrows register-key"),
		);

		console.log(chalk.cyan("\nExample usage:"));
		console.log(chalk.gray("git-escrows register-key"));
		console.log(chalk.gray("git-escrows check-key"));
		console.log(
			chalk.gray(
				'git-escrows submit --tests-repo "repo-url" --tests-commit "hash" --reward "1000" --arbiter "0x..." --oracle "0x..." --token "0x..."',
			),
		);

		// Exit successfully
		process.exit(0);
	} catch (error) {
		console.error(chalk.red("Failed to create client configuration:"));
		console.error(
			chalk.red(error instanceof Error ? error.message : String(error)),
		);
		process.exit(1);
	}
}
