import chalk from 'chalk';
import { createClientFromEnv, requireEnvFile } from '../utils/envLoader.js';

interface CollectOptions {
  escrowUid: string;
  fulfillmentUid: string;
}

export async function collectCommand(options: CollectOptions) {
  try {
    console.log(chalk.blue('Collecting escrow reward...'));
    
    // Validate inputs
    if (!options.escrowUid || !options.fulfillmentUid) {
      throw new Error('Missing required options: --escrow-uid, --fulfillment-uid');
    }

    // Check for .env file and load client
    requireEnvFile();
    
    console.log(chalk.gray('Setting up blockchain client...'));
    const { client, config } = await createClientFromEnv();

    console.log(chalk.gray('Collection details:'));
    console.log(chalk.gray(`  Escrow UID: ${options.escrowUid}`));
    console.log(chalk.gray(`  Fulfillment UID: ${options.fulfillmentUid}`));

    console.log(chalk.gray('Submitting collection transaction...'));

    // Collect the escrow reward
    const collectionHash = await client.erc20.collectEscrow(
      options.escrowUid as `0x${string}`,
      options.fulfillmentUid as `0x${string}`,
    );

    console.log(chalk.green('Reward collected successfully!'));
    console.log(chalk.white('Collection Details:'));
    console.log(chalk.gray(`  Transaction Hash: ${collectionHash}`));
    console.log(chalk.gray(`  Escrow UID: ${options.escrowUid}`));
    console.log(chalk.gray(`  Fulfillment UID: ${options.fulfillmentUid}`));
    
    console.log(chalk.yellow('\nCongratulations!'));
    console.log(chalk.yellow('Your solution passed the tests and you have been rewarded!'));

    // Exit successfully
    process.exit(0);

  } catch (error) {
    console.error(chalk.red('Failed to collect reward:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
