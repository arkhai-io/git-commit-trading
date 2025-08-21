import chalk from 'chalk';
import { encodeAbiParameters, parseAbiParameters } from 'viem';
import { setupTest } from '../../../tests/utils/setup.js';
import { CommitAlgo } from '../../clients/commitObligation.js';
import { getClientOrSetupTest } from '../utils/clientLoader.js';

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

    // Setup client environment (try client_info.json first, then fallback to test setup)
    console.log(chalk.gray('Setting up blockchain environment...'));
    const setup = await getClientOrSetupTest();
    const aliceClient = setup.aliceClient;
    const testContext = setup.testContext;

    if (setup.isFromConfig) {
      console.log(chalk.green('Using client configuration from client_info.json'));
      console.log(chalk.gray(`Address: ${setup.clientInfo?.address}`));
      console.log(chalk.gray(`Network: ${setup.clientInfo?.network}`));
    } else {
      console.log(chalk.yellow('No client_info.json found, using test environment'));
    }

    // Use provided addresses or defaults from test setup (if available)
    let arbiterAddress, oracleAddress, tokenAddress;
    
    if (setup.isFromConfig) {
      // When using client_info.json, require explicit addresses or use common defaults
      arbiterAddress = options.arbiter;
      oracleAddress = options.oracle;
      tokenAddress = options.token;
      
      if (!arbiterAddress || !oracleAddress || !tokenAddress) {
        throw new Error('When using client configuration, you must provide --arbiter, --oracle, and --token addresses');
      }
    } else {
      // When using test environment, use test defaults
      arbiterAddress = options.arbiter || testContext!.addresses.trustedOracleArbiter;
      oracleAddress = options.oracle || testContext!.charlie;
      tokenAddress = options.token || testContext!.mockAddresses.erc20A;
    }

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
    const demand = aliceClient.arbiters.encodeTrustedOracleDemand({
      oracle: oracleAddress,
      data: commitTestsData,
    });

    console.log(chalk.gray('Creating escrow with demand...'));

    // Create the escrow by depositing tokens
    const rewardAmount = BigInt(options.reward);
    const { attested: escrow } = await aliceClient.erc20.permitAndBuyWithErc20(
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
