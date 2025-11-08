import chalk from 'chalk';
import { createClientFromEnv, requireEnvFile, validateGitKeyEnv } from '../utils/envLoader.js';
import { KeyType } from '../../clients/gitIdentityRegistry.js';

interface CheckKeyOptions {
  address?: string;
  verbose?: boolean;
}

export async function checkKeyCommand(options: CheckKeyOptions) {
  try {
    console.log(chalk.blue('Checking Git key registration status...'));

    // Validate .env has all required fields for Git Key operations
    validateGitKeyEnv();

    console.log(chalk.gray('Setting up blockchain client...'));
    const { client, config, hasGitIdentityRegistry } = await createClientFromEnv();

    if (!hasGitIdentityRegistry) {
      throw new Error('GIT_IDENTITY_REGISTRY_ADDRESS is required in .env file for this command');
    }

    const addressToCheck = (options.address || config.address) as `0x${string}`;
    console.log(chalk.gray(`Checking address: ${addressToCheck}`));

    try {
      const keyClaim = await client.gitIdentityRegistry.getLatestKeyClaim(addressToCheck);

      if (!keyClaim || !keyClaim.publicKey || keyClaim.publicKey.trim() === "") {
        console.log(chalk.red('❌ No Git key registered for this address'));
        console.log(chalk.yellow('\nTo register your Git SSH key:'));
        console.log(chalk.yellow('  git-escrows register-key'));
        console.log(chalk.yellow('\nOr specify a custom key path:'));
        console.log(chalk.yellow('  git-escrows register-key --path ~/.ssh/id_ed25519.pub'));
        return;
      }

      console.log(chalk.green('✅ Git key is registered!'));
      console.log(chalk.white('\nRegistered Key Details:'));
      console.log(chalk.gray(`  Address: ${addressToCheck}`));
      console.log(chalk.gray(`  Key Type: ${KeyType[keyClaim.keyType] || `Unknown (${keyClaim.keyType})`}`));
      console.log(chalk.gray(`  Public Key: ${keyClaim.publicKey.substring(0, 32)}...`));

      if (options.verbose) {
        console.log(chalk.gray(`  Full Public Key: ${keyClaim.publicKey}`));
        console.log(chalk.gray(`  Nonce Hash: ${keyClaim.nonceHash}`));
        console.log(chalk.gray(`  Signature: ${keyClaim.sig.substring(0, 32)}...`));
      }

      console.log(chalk.yellow('\nWhat this means:'));
      console.log(chalk.yellow('  • Git commits signed with this SSH / PGP key are linked to your Ethereum address'));
      console.log(chalk.yellow('  • You can fulfill escrows and prove authorship of commits'));
      console.log(chalk.yellow('  • The oracle will verify your commit signatures against this registered key'));

    } catch (error) {
      console.error(chalk.red('❌ Failed to check key registration:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    }

  } catch (error) {
    console.error(chalk.red('❌ Failed to check Git key registration:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));

    console.log(chalk.yellow('\nTroubleshooting:'));
    console.log(chalk.yellow('  1. Ensure your .env file contains GIT_IDENTITY_REGISTRY_ADDRESS'));
    console.log(chalk.yellow('  2. Check that you are connected to the correct network'));
    console.log(chalk.yellow('  3. Verify the address is correct'));

    process.exit(1);
  }
}
