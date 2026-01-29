import chalk from 'chalk';
import { parseAbiParameters, decodeAbiParameters } from 'viem';
import { CommitAlgo, type CommitObligationData } from '../../clients/commitObligation.js';
import { createClientFromEnv, requireEnvFile } from '../utils/envLoader.js';

interface FulfillOptions {
  escrowUid: string;
  solutionRepo: string;
  solutionCommit: string;
  solutionAlgo?: string;
  additionalHosts?: string;
  verifyKey?: boolean;
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

    // Check for .env file and load client
    requireEnvFile();

    console.log(chalk.gray('Setting up blockchain client...'));
    const { client, config, hasCommitObligation, hasGitIdentityRegistry } = await createClientFromEnv();

    if (!hasCommitObligation) {
      throw new Error('COMMIT_OBLIGATION_ADDRESS is required in .env file for this command');
    }

    if (!client.gitIdentityRegistry) {
      throw new Error('Git Identity Registry client not initialized');
    }

    // Verify git key registration if requested
    if (options.verifyKey !== false && hasGitIdentityRegistry) {
      console.log(chalk.gray('Verifying registered Git key...'));
      try {
        const latestKeyClaim = await client.gitIdentityRegistry.getLatestKeyClaim(config.address as `0x${string}`);
        if (!latestKeyClaim || !latestKeyClaim.publicKey || latestKeyClaim.publicKey.trim() === "") {
          console.log(chalk.yellow('⚠️ No Git keys registered for this address.'));
          console.log(chalk.yellow('   Register your Git SSH or PGP key first with: git-escrows register-key'));
          console.log(chalk.yellow('   Or use --no-verify-key to skip verification (not recommended)'));
        } else {
          console.log(chalk.green(`✓ Git key registration verified - latest key found`));
          console.log(chalk.gray(`  Key type: ${latestKeyClaim.keyType === 0 ? 'PGP' : latestKeyClaim.keyType === 1 ? 'SSH-Ed25519' : 'SSH-Secp256k1'}`));
        }
      } catch (error) {
        console.log(chalk.yellow('⚠️ Could not verify Git key registration:', error));
      }
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
    const { attested: fulfillment } = await client.commitObligation!.doObligation(
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

    // Request arbitration from the oracle
    console.log(chalk.gray('Requesting arbitration from oracle...'));
    try {
      // Get the escrow to find the oracle address
      const escrowAttestation = await client.getEscrowAttestation({ refUID: options.escrowUid as `0x${string}` });
      
      // First decode the escrow obligation structure: (address arbiter, bytes demand, address token, uint256 amount)
      const escrowAbi = parseAbiParameters("(address arbiter, bytes demand, address token, uint256 amount)");
      const decodedEscrow = decodeAbiParameters(escrowAbi, escrowAttestation.data);
      const demandBytes = decodedEscrow[0].demand;
      
      // Then decode the TrustedOracleDemand from the demand bytes: (address oracle, bytes data)
      const demandAbi = parseAbiParameters("(address oracle, bytes data)");
      const decodedDemand = decodeAbiParameters(demandAbi, demandBytes);
      const oracleAddress = decodedDemand[0].oracle;
      
      console.log(chalk.gray(`  Oracle Address: ${oracleAddress}`));
      
      // Request arbitration
      await new Promise(resolve => setTimeout(resolve, 2000));
      const arbitrationTx = await client.arbiters.general.trustedOracle.requestArbitration(fulfillment.uid, oracleAddress,demandBytes);
      console.log(chalk.green('Arbitration requested successfully!'));
      console.log(chalk.gray(`  Arbitration Request Transaction: ${arbitrationTx}`));
      
    } catch (error) {
      console.log(chalk.yellow('⚠️ Failed to request arbitration:'), error);
      console.log(chalk.yellow('   The oracle may still detect the fulfillment, but arbitration request is recommended'));
    }

    console.log(chalk.yellow('\nNext steps:'));
    console.log(chalk.yellow('  1. The arbiter server will automatically test your solution'));
    console.log(chalk.yellow('  2. If tests pass, you can collect the reward with:'));
    console.log(chalk.yellow(`     git-escrows collect --escrow-uid ${options.escrowUid} --fulfillment-uid ${fulfillment.uid}`));

    // Exit successfully
    process.exit(0);

  } catch (error) {
    console.error(chalk.red('Failed to submit fulfillment:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
