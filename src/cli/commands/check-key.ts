import chalk from "chalk";
import { KeyType } from "../../clients/gitIdentityRegistry.js";
import { createClientFromEnv, validateGitKeyEnv } from "../utils/envLoader.js";

interface CheckKeyOptions {
	address?: string;
	verbose?: boolean;
}

export async function checkKeyCommand(options: CheckKeyOptions) {
	try {
		console.log(chalk.blue("Checking Git key registration status..."));

		// Validate .env has all required fields for Git Key operations
		validateGitKeyEnv();

		console.log(chalk.gray("Setting up blockchain client..."));
		const { gitIdentityRegistryClient, address, hasGitIdentityRegistry } =
			await createClientFromEnv();

		if (!hasGitIdentityRegistry || !gitIdentityRegistryClient) {
			throw new Error(
				"GIT_IDENTITY_REGISTRY_ADDRESS is required in .env file for this command",
			);
		}

		// Normalize address to lowercase to avoid checksum case mismatches
		const addressToCheck = (
			(options.address || address) as string
		).toLowerCase() as `0x${string}`;
		console.log(chalk.gray(`Checking address: ${addressToCheck}`));

		try {
			const latestKeyClaim =
				await gitIdentityRegistryClient.getLatestKeyClaim(addressToCheck);

			if (
				!latestKeyClaim ||
				!latestKeyClaim.publicKey ||
				latestKeyClaim.publicKey.trim() === ""
			) {
				console.log(chalk.red("❌ No Git keys registered for this address"));
				console.log(chalk.yellow("\nTo register your Git SSH or PGP key:"));
				console.log(chalk.yellow("  git-escrows register-key"));
				console.log(chalk.yellow("\nOr specify a custom key path:"));
				console.log(
					chalk.yellow(
						"  git-escrows register-key --path ~/.ssh/id_ed25519.pub",
					),
				);
				return;
			}

			console.log(chalk.green(`✅ Git key registered!`));
			console.log(chalk.white("\nLatest Registered Key:"));
			console.log(chalk.gray(`  Address: ${addressToCheck}`));
			console.log(
				chalk.gray(
					`  Key Type: ${KeyType[latestKeyClaim.keyType] || `Unknown (${latestKeyClaim.keyType})`}`,
				),
			);
			console.log(
				chalk.gray(
					`  Public Key: ${latestKeyClaim.publicKey.substring(0, 32)}...`,
				),
			);

			if (options.verbose) {
				console.log(
					chalk.gray(`  Full Public Key: ${latestKeyClaim.publicKey}`),
				);
				console.log(chalk.gray(`  Nonce Hash: ${latestKeyClaim.nonceHash}`));
				console.log(
					chalk.gray(`  Signature: ${latestKeyClaim.sig.substring(0, 32)}...`),
				);
			}

			console.log(chalk.yellow("\nWhat this means:"));
			console.log(
				chalk.yellow(
					"  • Git commits signed with this SSH/PGP key are linked to your Ethereum address",
				),
			);
			console.log(
				chalk.yellow(
					"  • You can fulfill escrows and prove authorship of commits",
				),
			);
			console.log(
				chalk.yellow(
					"  • The oracle will verify your commit signatures against this registered key",
				),
			);
			console.log(
				chalk.gray(
					"\nNote: Only the latest registered key is used for verification",
				),
			);
		} catch (error) {
			console.error(chalk.red("❌ Failed to check key registration:"));
			console.error(
				chalk.red(error instanceof Error ? error.message : String(error)),
			);
		}
	} catch (error) {
		console.error(chalk.red("❌ Failed to check Git key registration:"));
		console.error(
			chalk.red(error instanceof Error ? error.message : String(error)),
		);

		console.log(chalk.yellow("\nTroubleshooting:"));
		console.log(
			chalk.yellow(
				"  1. Ensure your .env file contains GIT_IDENTITY_REGISTRY_ADDRESS",
			),
		);
		console.log(
			chalk.yellow("  2. Check that you are connected to the correct network"),
		);
		console.log(chalk.yellow("  3. Verify the address is correct"));

		process.exit(1);
	}
}
