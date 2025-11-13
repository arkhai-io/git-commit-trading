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
    let escrow;

    try {
      // Try with permit first (EIP-2612)
      console.log(chalk.gray('Attempting to use EIP-2612 permit...'));
      const result = await client.erc20.permitAndBuyWithErc20(
        {
          address: tokenAddress,
          value: rewardAmount,
        },
        { arbiter: arbiterAddress, demand },
        0n,
      );
      escrow = result.attested;
      console.log(chalk.green('✓ Used EIP-2612 permit'));
    } catch (permitError: any) {
      // If permit fails, fallback to approve + transfer
      console.log(chalk.yellow('EIP-2612 permit not supported, falling back to approve + transfer'));
      console.log(chalk.gray('Approving token spend...'));

      // First approve the tokens
      const approveHash = await client.erc20.approve(
        {
          address: tokenAddress,
          value: rewardAmount,
        },
        'escrow'
      );

      console.log(chalk.gray(`Approval tx: ${approveHash}`));
      
      // Debug: Get transaction details to see what nonce was used
      try {
        const tx = await client.viemClient.getTransaction({ hash: approveHash });
        console.log(chalk.blue(`Transaction nonce used: ${tx.nonce}`));
      } catch (txError) {
        console.log(chalk.yellow(`Could not fetch transaction details: ${txError instanceof Error ? txError.message : String(txError)}`));
      }
      
      console.log(chalk.gray('Waiting for approval to be mined (this may take a while on Base Sepolia)...'));

      try {
        // Wait for the approval transaction to be confirmed with longer timeout for Base Sepolia
        await client.viemClient.waitForTransactionReceipt({
          hash: approveHash,
          timeout: 180_000  // 3 minutes timeout for Base Sepolia
        });
        console.log(chalk.green('✓ Approval confirmed'));
      } catch (error) {
        console.log(chalk.yellow('⚠ Approval confirmation timed out, but transaction was submitted'));
        console.log(chalk.gray('Waiting 30 seconds for network propagation before proceeding...'));
        await new Promise(resolve => setTimeout(resolve, 30000));
        console.log(chalk.gray('Proceeding with escrow creation...'));
      }

      // Now create the escrow
      console.log(chalk.gray('Creating escrow...'));
      const result = await client.erc20.buyWithErc20(
        {
          address: tokenAddress,
          value: rewardAmount,
        },
        { arbiter: arbiterAddress, demand },
        0n,
      );
      escrow = result.attested;
      console.log(chalk.green('✓ Used approve + transfer'));
    }

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
    console.log(chalk.yellow('  2. Developers can fulfill using: git-escrows fulfill --escrow-uid ' + escrow.uid + ' --solution-repo "https://git.repo" --solution-algo "sha1" --solution-commit "developer-commit-hash"'));

    // Exit successfully
    process.exit(0);

  } catch (error) {
    console.error(chalk.red('Failed to create escrow:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
