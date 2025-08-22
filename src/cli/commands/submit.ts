import chalk from 'chalk';
import { encodeAbiParameters, parseAbiParameters } from 'viem';
import { CommitAlgo } from '../../clients/commitObligation.js';
import { createClientFromEnv, requireEnvFile } from '../utils/envLoader.js';

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
    console.log(chalk.blue('Creating new escrow demand...'));
    
    // Validate inputs
    if (!options.testsRepo || !options.testsCommit || !options.reward) {
      throw new Error('Missing required options: --tests-repo, --tests-commit, --reward');
    }

    // Parse commit algorithm
    const commitAlgoMap: Record<string, number> = {
      'sha1': CommitAlgo.SHA256, // Note: using SHA256 as default based on test
      'sha256': CommitAlgo.SHA256,
      'md5': CommitAlgo.MD5,
    };
    
    const testsAlgo = commitAlgoMap[options.testsAlgo?.toLowerCase() || 'sha1'];
    if (testsAlgo === undefined) {
      throw new Error(`Invalid commit algorithm: ${options.testsAlgo}. Use: sha1, sha256, or md5`);
    }

    // Check for .env file and load client
    requireEnvFile();
    
    console.log(chalk.gray('Setting up blockchain client...'));
    const { client, config, hasCommitObligation } = await createClientFromEnv();
    
    if (!hasCommitObligation) {
      throw new Error('COMMIT_OBLIGATION_ADDRESS is required in .env file for this command');
    }

    // Require explicit addresses when using environment configuration
    if (!options.arbiter || !options.oracle || !options.token) {
      throw new Error('You must provide --arbiter, --oracle, and --token addresses when using environment configuration');
    }
    
    const arbiterAddress = options.arbiter;
    const oracleAddress = options.oracle; 
    const tokenAddress = options.token;

    // Encode the demand data
    const encodeCommitTestsDemand = (demand: {
      testsCommitHash: string;
      testsCommand: string;
      testsCommitAlgo: number;
      hosts: string[];
    }) => {
      return encodeAbiParameters(
        parseAbiParameters("(string testsCommitHash, string testsCommand, uint8 testsCommitAlgo, string[] hosts)"),
        [demand],
      );
    };

    const commitTestsData = encodeCommitTestsDemand({
      testsCommitHash: options.testsCommit,
      testsCommand: options.testsCommand || 'npm test',
      testsCommitAlgo: testsAlgo,
      hosts: [options.testsRepo]
    });

    console.log(chalk.gray('Encoding demand with data:'));
    console.log(chalk.gray(`  Tests Repo: ${options.testsRepo}`));
    console.log(chalk.gray(`  Tests Commit: ${options.testsCommit}`));
    console.log(chalk.gray(`  Tests Command: ${options.testsCommand || 'npm test'}`));
    console.log(chalk.gray(`  Commit Algorithm: ${options.testsAlgo || 'sha1'}`));

    // Create the trusted oracle demand
    const demand = client.arbiters.encodeTrustedOracleDemand({
      oracle: oracleAddress,
      data: commitTestsData,
    });

    console.log(chalk.gray('Creating escrow with demand...'));

    // Create the escrow by depositing tokens
    const rewardAmount = BigInt(options.reward);
    const { attested: escrow } = await client.erc20.permitAndBuyWithErc20(
      {
        address: tokenAddress,
        value: rewardAmount,
      },
      { arbiter: arbiterAddress, demand },
      0n,
    );

    console.log(chalk.green('Escrow created successfully!'));
    console.log(chalk.white('Escrow Details:'));
    console.log(chalk.gray(`  Escrow UID: ${escrow.uid}`));
    console.log(chalk.gray(`  Attester: ${escrow.attester}`));
    console.log(chalk.gray(`  Recipient: ${escrow.recipient}`));
    console.log(chalk.gray(`  Schema UID: ${escrow.schema}`));
    console.log(chalk.gray(`  Reward: ${rewardAmount} tokens`));
    console.log(chalk.gray(`  Token: ${tokenAddress}`));
    console.log(chalk.gray(`  Oracle: ${oracleAddress}`));
    console.log(chalk.gray(`  Arbiter: ${arbiterAddress}`));
    
    console.log(chalk.yellow('\nNext steps:'));
    console.log(chalk.yellow('  1. Share the Escrow UID with developers'));
    console.log(chalk.yellow('  2. Developers can fulfill using: git-escrows fulfill --escrow-uid ' + escrow.uid));
    console.log(chalk.yellow('  3. Run the arbiter server: git-escrows server'));

    // Exit successfully
    process.exit(0);

  } catch (error) {
    console.error(chalk.red('Failed to create escrow:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
