import chalk from 'chalk';
import { parseAbiParameters } from 'viem';
import { createClientFromEnv, requireEnvFile } from '../utils/envLoader.js';
import { GitTestExecution } from '../../test-execution/index.js';
import { verifyGitKeyClaimSignature } from '../../utils/sshSignatureUtils.js';
import { getGitVerificationService } from '../../services/verificationService.js';

/**
 * Try an async operation with each host in order until one succeeds.
 * Returns the result from the first successful host.
 * Throws the last error if all hosts fail.
 */
async function tryHosts<T>(
  hosts: string[],
  operation: (host: string) => Promise<T>,
  operationName: string
): Promise<{ result: T; host: string }> {
  if (hosts.length === 0) {
    throw new Error(`No hosts provided for ${operationName}`);
  }

  let lastError: Error | null = null;
  for (const host of hosts) {
    try {
      const result = await operation(host);
      return { result, host };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.log(chalk.yellow(`  ⚠️ ${operationName} failed for host ${host}: ${lastError.message}`));
      if (hosts.indexOf(host) < hosts.length - 1) {
        console.log(chalk.gray(`  Trying next host...`));
      }
    }
  }

  throw new Error(`${operationName} failed for all hosts. Last error: ${lastError?.message}`);
}

interface ServerOptions {
  port?: string;
  pollingInterval?: string;
  timeout?: string;
  cleanup?: boolean;
  past?: boolean;
  listen?: boolean;
  skipKeyVerification?: boolean;
  useGitVerifyCommit?: boolean;
  transport?: 'http' | 'websocket';
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
    const transport = options.transport || 'http';

    console.log(chalk.gray('Server configuration:'));
    console.log(chalk.gray(`  Mode: ${options.past ? 'Arbitrate Past' : 'Listen and Arbitrate'}`));
    console.log(chalk.gray(`  Transport: ${transport.toUpperCase()}`));
    console.log(chalk.gray(`  Polling Interval: ${pollingInterval}ms`));
    console.log(chalk.gray(`  Test Timeout: ${timeout}ms`));
    console.log(chalk.gray(`  Cleanup: ${cleanup}`));
    console.log(chalk.gray(`  Git Verify Commit: ${useGitVerifyCommit ? 'Enabled' : 'Disabled'}`));
    console.log(chalk.gray(`  Container Execution: Enabled (framework-based)`));

    // Initialize container pool manager (no pre-warming, containers built on-demand)
    console.log(chalk.cyan('Initializing container pool manager...'));
    const containerPoolConfig = {
      repositories: {
        source: { url: '', commitHash: '' },
        testcase: { url: '', commitHash: '' }
      },
      execution: {
        timeout,
        cleanupAfterExecution: cleanup,
        isolatedEnvironment: true,
        tempDirectory: './temp',
        containerPool: {
          enabled: true,
          poolSize: 5, // Not used for pre-warming, just for tracking
          containerPrefix: 'test-executor',
          resetStrategy: 'cleanup' as const
        }
      }
    };
    
    await GitTestExecution.initializeContainerPool(containerPoolConfig);
    console.log(chalk.green(`✓ Container pool manager ready`));
    console.log(chalk.gray(`   Containers will be built on-demand based on detected framework`));

    // Check for .env file and load client
    requireEnvFile();

    console.log(chalk.gray('Setting up blockchain client...'));
    const { client, config, hasCommitObligation, hasGitIdentityRegistry } = await createClientFromEnv('.env', transport);

    if (!hasCommitObligation) {
      throw new Error('COMMIT_OBLIGATION_ADDRESS is required in .env file for the server command');
    }

    console.log(chalk.green('Blockchain environment ready'));
    console.log(chalk.gray(`  Oracle Address (Your Wallet): ${config.address}`));
    console.log(chalk.gray(`  CommitObligation Contract: ${config.commitObligationAddress}`));
    console.log(chalk.gray(`  TrustedOracleArbiter Contract: ${client.contractAddresses.trustedOracleArbiter}`));

    if (hasGitIdentityRegistry) {
      console.log(chalk.gray(`  GitIdentityRegistry Contract: ${config.gitIdentityRegistryAddress}`));
      console.log(chalk.green('✓ Git key verification enabled'));
    } else {
      console.log(chalk.yellow('⚠️ GitIdentityRegistry not available - Git key verification disabled'));
    }

    // Initialize Git verification service if enabled
    let gitVerificationService = null;
    if (!options.skipKeyVerification && hasGitIdentityRegistry && useGitVerifyCommit) {
      
      gitVerificationService = getGitVerificationService({
        timeoutMs: timeout,
        cleanupAfterVerification: cleanup,
      });
      
      const initialized = await gitVerificationService.initialize();
      if (initialized) {
        
        // Log service capabilities
        const stats = gitVerificationService.getStats();
        console.log(chalk.gray('  Git verification capabilities:'));
        console.log(chalk.gray(`    SSH: ${stats.config.enableSSH ? 'OK' : 'NOT AVAILABLE'}`));
        console.log(chalk.gray(`    GPG: ${stats.config.enableGPG ? 'OK' : 'NOT AVAILABLE'}`));
        console.log(chalk.gray(`    X509: ${stats.config.enableX509 ? 'OK' : 'NOT AVAILABLE'}`));
        console.log(chalk.gray(`    Auto-import keys: ${stats.config.autoImportKeys ? 'OK' : 'NOT AVAILABLE'}`));
        console.log(chalk.gray(`    Caching: ${stats.config.enableCaching ? 'OK' : 'NOT AVAILABLE'}`));
      } else {
        console.log(chalk.yellow('⚠️ Git verification service initialization failed'));
        gitVerificationService = null;
      }
    }

    // Define the arbitration logic with Git key verification
    const arbitrate = async (attestation: any) => {
      console.log(chalk.green('=============== Received new fulfillment to be arbitrated ==============='));
      console.log("Arbitrating attestation:", attestation);
      
      // Decode the obligation data from the attestation
      const obligationData = client.extractObligationData(
        parseAbiParameters("(string commitHash,uint8 commitAlgo,string[] hosts,address sender)"),
        attestation
      );
      
      // Get the escrow attestation and decode demand data
      const escrowAttestation = await client.getEscrowAttestation(attestation);
      const demandData = client.extractDemandData(
        parseAbiParameters("(string testsCommitHash, string testsCommand, uint8 testsCommitAlgo, string[] hosts)"),
        escrowAttestation
      );

      // Extract sender address from the obligation
      const obligation = obligationData[0];
      // Normalize sender address to lowercase to avoid checksum case mismatches
      const senderAddress = obligation.sender.toLowerCase();
      console.log(`🔍 Fulfillment submitted by: ${senderAddress}`);

      // Step 1: Verify Git key registration and commit signature (if enabled)
      if (!options.skipKeyVerification && hasGitIdentityRegistry && client.gitIdentityRegistry) {
        console.log('\n🔐 Verifying Git key registration and commit signature...');

        try {
          // Get the latest registered key for the sender
          let latestKeyClaim: any;
          try {
            latestKeyClaim = await client.gitIdentityRegistry.getLatestKeyClaim(senderAddress);
            if (!latestKeyClaim || !latestKeyClaim.publicKey || latestKeyClaim.publicKey.trim() === "") {
              console.log('❌ No valid registered Git key found for sender address');
              console.log('   Fulfillment rejected: sender must register their Git SSH or PGP key first');
              return false;
            }
            
            console.log(`✅ Found latest registered Git key for sender`);
            console.log(`   Key type: ${latestKeyClaim.keyType === 0 ? 'PGP' : latestKeyClaim.keyType === 1 ? 'SSH-Ed25519' : latestKeyClaim.keyType === 2 ? 'SSH-Secp256k1' : 'X509'}`);
          } catch (error) {
            console.log('❌ Failed to retrieve Git key registration:', error);
            return false;
          }

          // Verify GitKeyClaim signature to ensure the key was properly registered
          console.log('🔐 Verifying GitKeyClaim signature...');
          const isValidKeyClaim = await verifyGitKeyClaimSignature(latestKeyClaim, senderAddress);
          if (!isValidKeyClaim) {
            console.log('❌ GitKeyClaim signature is invalid - key registration may be compromised');
            console.log('   Fulfillment rejected: invalid key registration');
            return false;
          }
          console.log('✅ GitKeyClaim signature verified');

          // Use enhanced Git verification service if available
          if (gitVerificationService) {
            console.log('🔐 Verifying commit signature using git verify-commit...');

            // Create a map with only the latest key
            const registeredKeys = new Map();
            registeredKeys.set(senderAddress, latestKeyClaim);

            // Try each host until verification succeeds
            const { result: verificationResult, host: usedHost } = await tryHosts(
              obligation.hosts,
              async (host) => {
                const result = await gitVerificationService.verifyCommit(
                  host,
                  obligation.commitHash,
                  registeredKeys
                );
                if (!result.isValid) {
                  throw new Error(result.error || 'Verification failed');
                }
                return result;
              },
              'Commit signature verification'
            );

            console.log('✅ Commit signature verified using git verify-commit');
            console.log(`   Host: ${usedHost}`);
            console.log(`   Method: ${verificationResult.verificationDetails.method}`);
            console.log(`   Signed by: ${verificationResult.registeredAddress}`);

          } else {
            console.log('❌ Git verification service not available');
            console.log('   Fulfillment rejected: cannot verify commit signature without git verify-commit');
            return false;
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

        // Extract demand data
        const demand = demandData[0];

        // If test command doesn't include installation (no && or ;), auto-detect install command
        // This allows users to submit just "poetry run pytest" and have "poetry install --with dev" run automatically
        const hasInstallInCommand = /&&|;/.test(demand.testsCommand);
        if (!hasInstallInCommand) {
          console.log('🔍 Test command does not include install step, will auto-detect install command from testcase repo');
        }

        // Set execution parameters
        testConfig.execution.timeout = timeout;
        testConfig.execution.cleanupAfterExecution = cleanup;
        testConfig.repositories.testcase.commitHash = demand.testsCommitHash;
        testConfig.repositories.testcase.testCommand = demand.testsCommand;
        testConfig.repositories.source.commitHash = obligation.commitHash;

        // Try each host for testcase repo, then each host for source repo
        let result: Awaited<ReturnType<typeof GitTestExecution.executeTests>> | null = null;
        let workingTestcaseHost: string | null = null;
        let workingSourceHost: string | null = null;

        // First: find a working testcase host
        for (const testcaseHost of demand.hosts) {
          testConfig.repositories.testcase.url = testcaseHost;
          testConfig.repositories.source.url = obligation.hosts[0]; // Use first source host for initial attempt

          console.log('📁 Trying testcase host:');
          console.log(`   Test repo: ${testcaseHost}`);

          result = await GitTestExecution.executeTests(testConfig, {
            onProgress: (step) => console.log(`  → ${step}`)
          });

          if (result.testcaseCloned) {
            workingTestcaseHost = testcaseHost;
            if (result.sourceCloned) {
              workingSourceHost = obligation.hosts[0];
            }
            break;
          }
          console.log(chalk.yellow(`  ⚠️ Failed to clone testcase from ${testcaseHost}. Trying next host...`));
        }

        if (!workingTestcaseHost) {
          console.log(chalk.red(`❌ Failed to clone testcase repository from any host`));
          return false;
        }

        // Second: if source clone failed, try other source hosts
        if (!workingSourceHost && obligation.hosts.length > 1) {
          for (let i = 1; i < obligation.hosts.length; i++) {
            const sourceHost = obligation.hosts[i];
            testConfig.repositories.source.url = sourceHost;

            console.log('📁 Trying source host:');
            console.log(`   Solution repo: ${sourceHost}`);

            result = await GitTestExecution.executeTests(testConfig, {
              onProgress: (step) => console.log(`  → ${step}`)
            });

            if (result.sourceCloned) {
              workingSourceHost = sourceHost;
              break;
            }
            console.log(chalk.yellow(`  ⚠️ Failed to clone source from ${sourceHost}. Trying next host...`));
          }
        }

        if (!result || !workingSourceHost) {
          console.log(chalk.red(`❌ Failed to clone source repository from any host`));
          return false;
        }

        console.log('📁 Final repository configuration:');
        console.log(`   Test repo: ${workingTestcaseHost}`);
        console.log(`   Test commit: ${testConfig.repositories.testcase.commitHash}`);
        console.log(`   Solution repo: ${workingSourceHost}`);
        console.log(`   Solution commit: ${testConfig.repositories.source.commitHash}`);

        console.log(`\n🎯 Test execution result: ${result.testResult.success ? 'PASSED ✅' : 'FAILED ❌'}`);
        console.log(`   Duration: ${result.testResult.duration}ms`);
        
        if (!result.testResult.success) {
          console.log('\n❌ Test Failure Details:');
          
          if (result.testResult.error) {
            console.log('   Error:', result.testResult.error);
          }
          
          if (result.testResult.output && result.testResult.output.trim()) {
            console.log('\n   Test Output:');
            console.log('   ' + '─'.repeat(70));
            // Print last 100 lines of output to avoid overwhelming logs
            const outputLines = result.testResult.output.split('\n');
            const linesToShow = outputLines.slice(-100);
            if (outputLines.length > 100) {
              console.log(`   ... (showing last 100 of ${outputLines.length} lines)`);
            }
            linesToShow.forEach(line => console.log('   ' + line));
            console.log('   ' + '─'.repeat(70));
          } else {
            console.log('   (No output captured from test execution)');
          }
          
          // Log execution status for debugging
          console.log('\n   Execution Status:');
          console.log(`   - Source cloned: ${result.sourceCloned ? '✓' : '✗'}`);
          console.log(`   - Testcase cloned: ${result.testcaseCloned ? '✓' : '✗'}`);
          console.log(`   - Dependencies installed: ${result.dependenciesInstalled ? '✓' : '✗'}`);
          console.log(`   - Tests executed: ${result.testsExecuted ? '✓' : '✗'}`);
          
          // If working directory still exists, suggest manual inspection
          if (result.workingDirectory) {
            console.log(`\n   💡 For debugging, inspect: ${result.workingDirectory}`);
          }
        }

        return result.testResult.success;
      } catch (error) {
        console.error('❌ Error during test execution:', error);
        return false;
      }
    };

    if (options.past) {
      console.log(chalk.yellow('Arbitrating past obligations...'));

      const decisions = await client.oracle.arbitratePast(arbitrate, {
        skipAlreadyArbitrated: true,
        onAfterArbitrate: async (decision: any) => {
          console.log(chalk.green(`✓ Arbitration completed: ${decision.decision ? 'PASSED' : 'FAILED'}`));
          console.log(chalk.gray(`  Transaction Hash: ${decision.hash}`));
          console.log(chalk.gray(`  Attestation UID: ${decision.attestation.uid}`));
        },
      });

      console.log(chalk.green(`✓ Arbitration completed for ${decisions.length} past obligations`));
      console.log(chalk.gray(`  Decisions made: ${decisions.length}`));

      process.exit(0);
    } else {
      console.log(chalk.yellow('Listening for new obligations and arbitrating...'));
      console.log(chalk.gray('Server is watching for ArbitrationRequested events where:'));
      console.log(chalk.gray(`  - Contract: ${client.contractAddresses.trustedOracleArbiter}`));
      console.log(chalk.gray(`  - Oracle Address: ${config.address}`));
      console.log(chalk.gray(`  - Polling Interval: ${pollingInterval}ms`));
      console.log(chalk.gray('Press Ctrl+C to stop the server\n'));

      // Setup graceful shutdown before starting
      let unwatchFn: (() => void) | null = null;
      
      process.on('SIGINT', async () => {
        console.log(chalk.yellow('\nShutting down server...'));
        if (unwatchFn) {
          unwatchFn();
        }
        
        console.log(chalk.green('✓ Server shutdown complete'));
        
        process.exit(0);
      });

      // Handle uncaught errors
      process.on('uncaughtException', (error) => {
        console.error(chalk.red('❌ Uncaught exception:'), error);
        if (error.message?.includes('WebSocket') || error.message?.includes('connection')) {
          console.log(chalk.yellow('⚠️ Connection error detected. The server will attempt to reconnect...'));
        } else {
          // For non-connection errors, exit
          if (unwatchFn) unwatchFn();
          process.exit(1);
        }
      });

      process.on('unhandledRejection', (reason, promise) => {
        console.error(chalk.red('❌ Unhandled rejection at:'), promise, 'reason:', reason);
        if (reason && typeof reason === 'object' && 'message' in reason) {
          const msg = (reason as any).message;
          if (typeof msg === 'string' && (msg.includes('WebSocket') || msg.includes('connection'))) {
            console.log(chalk.yellow('⚠️ Connection error detected. The server will attempt to reconnect...'));
          } else {
            // For non-connection errors, exit
            if (unwatchFn) unwatchFn();
            process.exit(1);
          }
        }
      });

      // Start listening and arbitrating
      const { unwatch, decisions } = await client.oracle.listenAndArbitrate(arbitrate, {
        skipAlreadyArbitrated: true,
        onAfterArbitrate: async (decision: any) => {
          console.log(chalk.green(`✓ Arbitration completed: ${decision.decision ? 'PASSED' : 'FAILED'}`));
          console.log(chalk.gray(`  Transaction Hash: ${decision.hash}`));
          console.log(chalk.gray(`  Attestation UID: ${decision.attestation.uid}`));
        },
        pollingInterval,
      });

      unwatchFn = unwatch;

      // Log any past decisions that were processed
      if (decisions.length > 0) {
        console.log(chalk.green(`✓ Processed ${decisions.length} past arbitration requests`));
      } else {
        console.log(chalk.gray('No past arbitration requests found. Waiting for new requests...'));
      }

      console.log(chalk.green('✓ Server is now actively listening for arbitration requests...'));

      // Keep the process alive indefinitely
      await new Promise<void>((resolve) => {
        // This promise will only resolve when SIGINT is triggered
        // which will call process.exit(0) before it can resolve
      });
    }

  } catch (error) {
    console.error(chalk.red('Failed to start server:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
