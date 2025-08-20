import chalk from 'chalk';
import { setupTest } from '../../../tests/utils/setup.js';
import { getClientOrSetupTest } from '../utils/clientLoader.js';

interface CollectOptions {
  escrowUid: string;
  fulfillmentUid: string;
}

export async function collectCommand(options: CollectOptions) {
  try {
    console.log(chalk.blue('💰 Collecting escrow reward...'));
    
    // Validate inputs
    if (!options.escrowUid || !options.fulfillmentUid) {
      throw new Error('Missing required options: --escrow-uid, --fulfillment-uid');
    }

    // Setup client environment (try client_info.json first, then fallback to test setup)
    console.log(chalk.gray('Setting up blockchain environment...'));
    const setup = await getClientOrSetupTest();
    const bobClient = setup.bobClient;

    if (setup.isFromConfig) {
      console.log(chalk.green('✅ Using client configuration from client_info.json'));
      console.log(chalk.gray(`👤 Address: ${setup.clientInfo?.address}`));
      console.log(chalk.gray(`🌐 Network: ${setup.clientInfo?.network}`));
    } else {
      console.log(chalk.yellow('⚠️  No client_info.json found, using test environment'));
    }

    console.log(chalk.gray('Collection details:'));
    console.log(chalk.gray(`  Escrow UID: ${options.escrowUid}`));
    console.log(chalk.gray(`  Fulfillment UID: ${options.fulfillmentUid}`));

    console.log(chalk.gray('Submitting collection transaction...'));

    // Collect the escrow reward
    const collectionHash = await bobClient.erc20.collectEscrow(
      options.escrowUid as `0x${string}`,
      options.fulfillmentUid as `0x${string}`,
    );

    console.log(chalk.green('✅ Reward collected successfully!'));
    console.log(chalk.white('📄 Collection Details:'));
    console.log(chalk.gray(`  Transaction Hash: ${collectionHash}`));
    console.log(chalk.gray(`  Escrow UID: ${options.escrowUid}`));
    console.log(chalk.gray(`  Fulfillment UID: ${options.fulfillmentUid}`));
    
    console.log(chalk.yellow('\n🎉 Congratulations!'));
    console.log(chalk.yellow('Your solution passed the tests and you have been rewarded!'));

    // Exit successfully
    process.exit(0);

  } catch (error) {
    console.error(chalk.red('❌ Failed to collect reward:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
