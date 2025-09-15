import chalk from 'chalk';
import { parseAbiParameters } from 'viem';
import { createClientFromEnv, requireEnvFile } from '../utils/envLoader.js';
import { GitTestExecution } from '../../test-execution/index.js';
import { getSigningKeyFromGitHubCommit } from '../../utils/gitUtils.js';
import { verifyCommitSignature, verifyGitKeyClaimSignature } from '../../utils/sshSignatureUtils.js';
import { getGitVerificationService } from '../../services/verificationService.js';

interface ServerOptions {
  port?: string;
  pollingInterval?: string;
  timeout?: string;
  cleanup?: boolean;
  past?: boolean;
  listen?: boolean;
  skipKeyVerification?: boolean;
  useGitVerifyCommit?: boolean;
  fallbackToGitHub?: boolean;
}

export async function serverCommand(options: ServerOptions) {
  try {
    console.log(chalk.blue('Starting Git Escrows Arbiter Server...'));

    // Validate mode options
    if (options.past && options.listen) {
      throw new Error('Cannot use both --past and --listen options at the same time');
    }

    if (!options.past && !options.listen) {
      throw new Error('Must specify either --past or --listen mode');
    }

    const pollingInterval = parseInt(options.pollingInterval || '1000');
    const timeout = parseInt(options.timeout || '300000');
    const cleanup = options.cleanup !== false;
    const useGitVerifyCommit = options.useGitVerifyCommit ?? true;
    const fallbackToGitHub = options.fallbackToGitHub ?? false;

    console.log(chalk.gray('Server configuration:'));
    console.log(chalk.gray(`  Mode: ${options.past ? 'Arbitrate Past' : 'Listen and Arbitrate'}`));
    console.log(chalk.gray(`  Polling Interval: ${pollingInterval}ms`));
    console.log(chalk.gray(`  Test Timeout: ${timeout}ms`));
    console.log(chalk.gray(`  Cleanup: ${cleanup}`));
    console.log(chalk.gray(`  Git Verify Commit: ${useGitVerifyCommit ? 'Enabled' : 'Disabled'}`));
    console.log(chalk.gray(`  GitHub Fallback: ${fallbackToGitHub ? 'Enabled' : 'Disabled'}`));

    // Check for .env file and load client
    requireEnvFile();

    console.log(chalk.gray('Setting up blockchain client...'));
    const { client, config, hasCommitObligation, hasGitIdentityRegistry } = await createClientFromEnv();

    if (!hasCommitObligation) {
      throw new Error('COMMIT_OBLIGATION_ADDRESS is required in .env file for the server command');
    }

    console.log(chalk.green('Blockchain environment ready'));
    console.log(chalk.gray(`  Oracle Address: ${config.address}`));
    console.log(chalk.gray(`  CommitObligation Contract: ${config.commitObligationAddress}`));

    if (hasGitIdentityRegistry) {
      console.log(chalk.gray(`  GitIdentityRegistry Contract: ${config.gitIdentityRegistryAddress}`));
      console.log(chalk.green('✓ Git key verification enabled'));
    } else {
      console.log(chalk.yellow('⚠️ GitIdentityRegistry not available - Git key verification disabled'));
    }

    // Initialize Git verification service if enabled
    let gitVerificationService = null;
    if (!options.skipKeyVerification && hasGitIdentityRegistry && useGitVerifyCommit) {
      console.log(chalk.blue('🔧 Initializing Git verification service...'));
      
      gitVerificationService = getGitVerificationService({
        fallbackToGitHub: fallbackToGitHub,
        timeoutMs: timeout,
        cleanupAfterVerification: cleanup,
      });
      
      const initialized = await gitVerificationService.initialize();
      if (initialized) {
        console.log(chalk.green('✅ Git verification service initialized'));
        
        // Log service capabilities
        const stats = gitVerificationService.getStats();
        console.log(chalk.gray('  Git verification capabilities:'));
        console.log(chalk.gray(`    SSH: ${stats.config.enableSSH ? '✅' : '❌'}`));
        console.log(chalk.gray(`    GPG: ${stats.config.enableGPG ? '✅' : '❌'}`));
        console.log(chalk.gray(`    X509: ${stats.config.enableX509 ? '✅' : '❌'}`));
        console.log(chalk.gray(`    Auto-import keys: ${stats.config.autoImportKeys ? '✅' : '❌'}`));
        console.log(chalk.gray(`    Caching: ${stats.config.enableCaching ? '✅' : '❌'}`));
      } else {
        console.log(chalk.yellow('⚠️ Git verification service initialization failed, falling back to GitHub API'));
        gitVerificationService = null;
      }
    }

    // Define the arbitration logic with Git key verification
    const arbitrate = async (obligation: any, demand: any) => {
      console.log("Arbitrating obligation:", obligation, "against demand:", demand);

      // Extract sender address from the obligation
      const senderAddress = obligation[0].sender;
      console.log(`🔍 Fulfillment submitted by: ${senderAddress}`);

      // Step 1: Verify Git key registration and commit signature (if enabled)
      if (!options.skipKeyVerification && hasGitIdentityRegistry && client.gitIdentityRegistry) {
        console.log('\n🔐 Verifying Git key registration and commit signature...');

        try {
          // Get all registered keys for verification
          const registeredKeys = new Map();
          
          // Get the registered key claim for the sender
          let senderKeyClaim: any;
          try {
            senderKeyClaim = await client.gitIdentityRegistry.getLatestKeyClaim(senderAddress);
            if (!senderKeyClaim || !senderKeyClaim.publicKey || senderKeyClaim.publicKey.trim() === "") {
              console.log('❌ No registered Git key found for sender address');
              console.log('   Fulfillment rejected: sender must register their Git SSH key first');
              return false;
            }
            console.log('✅ Found registered Git key for sender');
            registeredKeys.set(senderAddress, senderKeyClaim);
          } catch (error) {
            console.log('❌ Failed to retrieve Git key registration:', error);
            return false;
          }

          // Verify the GitKeyClaim signature itself
          console.log('🔐 Verifying GitKeyClaim signature...');
          const isValidClaim = verifyGitKeyClaimSignature(senderKeyClaim, senderAddress);
          if (!isValidClaim) {
            console.log('❌ GitKeyClaim signature is invalid');
            return false;
          }
          console.log('✅ GitKeyClaim signature verified');

          // Use enhanced Git verification service if available
          if (gitVerificationService) {
            console.log('🔐 Verifying commit signature using git verify-commit...');
            
            const verificationResult = await gitVerificationService.verifyCommit(
              obligation[0].hosts[0],
              obligation[0].commitHash,
              registeredKeys
            );
            
            if (!verificationResult.isValid) {
              console.log('❌ Commit signature verification failed');
              console.log(`   Method: ${verificationResult.verificationDetails.method}`);
              console.log(`   Error: ${verificationResult.error}`);
              console.log('   Fulfillment rejected: commit must be signed by sender\'s registered Git key');
              return false;
            }
            
            console.log('✅ Commit signature verified using git verify-commit');
            console.log(`   Method: ${verificationResult.verificationDetails.method}`);
            console.log(`   Signed by: ${verificationResult.registeredAddress}`);
            
          } else {
            // Fallback to GitHub API verification (original method)
            console.log('🔐 Verifying commit signature using GitHub API (fallback)...');
            
            const gitMetadata = await getSigningKeyFromGitHubCommit(
              obligation[0].hosts[0],
              obligation[0].commitHash
            );
            console.log('📝 Git commit metadata retrieved:', {
              verified: gitMetadata.verified,
              reason: gitMetadata.reason
            });

            const isSignedBySender = await verifyCommitSignature(gitMetadata, senderKeyClaim);
            if (!isSignedBySender) {
              console.log('❌ Commit was not signed by the sender\'s registered key');
              console.log('   Fulfillment rejected: commit must be signed by sender\'s registered Git key');
              return false;
            }
            console.log('✅ Commit signature verified using GitHub API');
          }

        } catch (error) {
          console.error('❌ Error during Git key verification:', error);
          console.log('   Fulfillment rejected due to verification error');
          return false;
        }
      } else if (options.skipKeyVerification) {
        console.log('⚠️ Git key verification skipped due to --skip-key-verification flag');
      } else {
        console.log('⚠️ Git key verification disabled (GitIdentityRegistry not available)');
      }

      // Step 2: Run the tests to verify the solution
      console.log('\n🧪 Running test execution...');
      try {
        const testConfig = GitTestExecution.initConfig();

        // Configure repositories from obligation and demand
        testConfig.repositories.testcase.url = demand[0].hosts[0];
        testConfig.repositories.testcase.commitHash = demand[0].testsCommitHash;
        testConfig.repositories.testcase.testCommand = demand[0].testsCommand;

        testConfig.repositories.source.url = obligation[0].hosts[0];
        testConfig.repositories.source.commitHash = obligation[0].commitHash;

        // Note: install, build, and test commands will be auto-detected from package.json
        // unless explicitly configured above

        // Set execution parameters
        testConfig.execution.timeout = timeout;
        testConfig.execution.cleanupAfterExecution = cleanup;

        console.log('📁 Repository configuration:');
        console.log(`   Test repo: ${testConfig.repositories.testcase.url}`);
        console.log(`   Test commit: ${testConfig.repositories.testcase.commitHash}`);
        console.log(`   Solution repo: ${testConfig.repositories.source.url}`);
        console.log(`   Solution commit: ${testConfig.repositories.source.commitHash}`);

        const result = await GitTestExecution.executeTests(testConfig, {
          onProgress: (step) => console.log(`  → ${step}`)
        });

        console.log(`\n🎯 Test execution result: ${result.testResult.success ? 'PASSED ✅' : 'FAILED ❌'}`);
        if (!result.testResult.success && result.testResult.error) {
          console.log('   Error details:', result.testResult.error);
        }

        return result.testResult.success;
      } catch (error) {
        console.error('❌ Error during test execution:', error);
        return false;
      }
    };

    // Set up arbitration parameters
    const arbitrationParams = {
      escrow: {
        attester: client.contractAddresses.erc20EscrowObligation,
        demandAbi: parseAbiParameters("(string testsCommitHash, string testsCommand, uint8 testsCommitAlgo, string[] hosts)"),
      },
      fulfillment: {
        attester: config.commitObligationAddress as `0x${string}`,
        obligationAbi: parseAbiParameters("(string commitHash,uint8 commitAlgo,string[] hosts,address sender)"),
      },
      arbitrate,
      onAfterArbitrate: async (decision: any) => {
        console.log(chalk.green(`✓ Arbitration completed: ${decision.decision ? 'PASSED' : 'FAILED'}`));
        console.log(chalk.gray(`  Transaction Hash: ${decision.hash}`));
        console.log(chalk.gray(`  Escrow UID: ${decision.escrowAttestation?.uid}`));
        console.log(chalk.gray(`  Fulfillment UID: ${decision.attestation.uid}`));
      },
      pollingInterval,
    };

    if (options.past) {
      console.log(chalk.yellow('� Arbitrating past obligations...'));

      const decisions = await client.oracle.arbitratePastForEscrow(arbitrationParams);

      console.log(chalk.green(`✓ Arbitration completed for ${decisions.decisions.length} past obligations`));
      console.log(chalk.gray(`  Escrows processed: ${decisions.escrows.length}`));
      console.log(chalk.gray(`  Decisions made: ${decisions.decisions.length}`));

      process.exit(0);
    } else {
      console.log(chalk.yellow('Listening for new obligations and arbitrating...'));
      console.log(chalk.gray('Press Ctrl+C to stop the server'));

      const { unwatch } = await client.oracle.listenAndArbitrateForEscrow(arbitrationParams);

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        console.log(chalk.yellow('\nShutting down server...'));
        unwatch();
        process.exit(0);
      });

      // Keep the process alive
      await new Promise(() => { }); // This will run indefinitely until SIGINT
    }

  } catch (error) {
    console.error(chalk.red('Failed to start server:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
