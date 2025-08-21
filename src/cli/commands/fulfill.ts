import chalk from 'chalk';
import { setupTest } from '../../../tests/utils/setup.js';
import { CommitAlgo, type CommitObligationData } from '../../clients/commitObligation.js';
import { getClientOrSetupTest } from '../utils/clientLoader.js';

interface FulfillOptions {
  escrowUid: string;
  solutionRepo: string;
  solutionCommit: string;
  solutionAlgo?: string;
  additionalHosts?: string;
}

export async function fulfillCommand(options: FulfillOptions) {
  try {
    console.log(chalk.blue('Submitting solution to fulfill escrow...'));
    
    // Validate inputs
    if (!options.escrowUid || !options.solutionRepo || !options.solutionCommit) {
      throw new Error('Missing required options: --escrow-uid, --solution-repo, --solution-commit');
    }

    // Parse commit algorithm
    const commitAlgoMap: Record<string, number> = {
      'sha1': CommitAlgo.SHA256, // Note: using SHA256 as default based on test
      'sha256': CommitAlgo.SHA256,
      'md5': CommitAlgo.MD5,
    };
    
    const solutionAlgo = commitAlgoMap[options.solutionAlgo?.toLowerCase() || 'sha1'];
    if (solutionAlgo === undefined) {
      throw new Error(`Invalid commit algorithm: ${options.solutionAlgo}. Use: sha1, sha256, or md5`);
    }

    // Setup client environment (try client_info.json first, then fallback to test setup)
    console.log(chalk.gray('Setting up blockchain environment...'));
    const setup = await getClientOrSetupTest();
    const bobClient = setup.bobClient;

    if (setup.isFromConfig) {
      console.log(chalk.green('Using client configuration from client_info.json'));
      console.log(chalk.gray(`Address: ${setup.clientInfo?.address}`));
      console.log(chalk.gray(`Network: ${setup.clientInfo?.network}`));
    } else {
      console.log(chalk.yellow('No client_info.json found, using test environment'));
    }

    // Parse additional hosts
    const hosts = [options.solutionRepo];
    if (options.additionalHosts) {
      const additionalHosts = options.additionalHosts.split(',').map(h => h.trim());
      hosts.push(...additionalHosts);
    }

    // Prepare the commit obligation data
    const obligationData: CommitObligationData = {
      commitHash: options.solutionCommit,
      commitAlgo: solutionAlgo,
      hosts: hosts,
    };

    console.log(chalk.gray('Fulfillment details:'));
    console.log(chalk.gray(`  Escrow UID: ${options.escrowUid}`));
    console.log(chalk.gray(`  Solution Repo: ${options.solutionRepo}`));
    console.log(chalk.gray(`  Solution Commit: ${options.solutionCommit}`));
    console.log(chalk.gray(`  Commit Algorithm: ${options.solutionAlgo || 'sha1'}`));
    console.log(chalk.gray(`  Additional Hosts: ${options.additionalHosts || 'none'}`));

    console.log(chalk.gray('Submitting fulfillment transaction...'));

    // Submit the fulfillment
    const { attested: fulfillment } = await bobClient.commitObligation.doObligation(
      obligationData,
      options.escrowUid as `0x${string}`,
    );

    console.log(chalk.green('Fulfillment submitted successfully!'));
    console.log(chalk.white('Fulfillment Details:'));
    console.log(chalk.gray(`  Fulfillment UID: ${fulfillment.uid}`));
    console.log(chalk.gray(`  Attester: ${fulfillment.attester}`));
    console.log(chalk.gray(`  Recipient: ${fulfillment.recipient}`));
    console.log(chalk.gray(`  Schema UID: ${fulfillment.schema}`));
    console.log(chalk.gray(`  Reference UID: ${options.escrowUid}`));
    
    console.log(chalk.yellow('\nNext steps:'));
    console.log(chalk.yellow('  1. The arbiter server will automatically test your solution'));
    console.log(chalk.yellow('  2. If tests pass, you can collect the reward with:'));
    console.log(chalk.yellow(`     git-escrows collect --escrow-uid ${options.escrowUid} --fulfillment-uid ${fulfillment.uid}`));
    console.log(chalk.yellow('  3. Monitor the arbiter server logs for test results'));

    // Exit successfully
    process.exit(0);

  } catch (error) {
    console.error(chalk.red('Failed to submit fulfillment:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
