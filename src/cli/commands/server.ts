import chalk from 'chalk';
import { parseAbiParameters } from 'viem';
import { createClientFromEnv, requireEnvFile } from '../utils/envLoader.js';
import { verifyAndRunTests, type RegisteredKey } from '../../test-execution/index.js';
import { verifyGitKeyClaimSignature } from '../../utils/sshSignatureUtils.js';

interface ServerOptions {
  port?: string;
  pollingInterval?: string;
  timeout?: string;
  cleanup?: boolean;
  past?: boolean;
  listen?: boolean;
  skipKeyVerification?: boolean;
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
    const transport = options.transport || 'http';

    console.log(chalk.gray('Server configuration:'));
    console.log(chalk.gray(`  Mode: ${options.past ? 'Arbitrate Past' : 'Listen and Arbitrate'}`));
    console.log(chalk.gray(`  Transport: ${transport.toUpperCase()}`));
    console.log(chalk.gray(`  Polling Interval: ${pollingInterval}ms`));
    console.log(chalk.gray(`  Test Timeout: ${timeout}ms`));
    console.log(chalk.gray(`  Cleanup: ${cleanup}`));
    console.log(chalk.gray(`  Docker Execution: Enabled (framework-based)`));

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

    // Create getRegisteredKey callback for verification
    const getRegisteredKey = async (address: `0x${string}`): Promise<RegisteredKey | null> => {
      if (!client.gitIdentityRegistry) {
        return null;
      }

      try {
        // Fetch the latest key claim from the contract
        const keyClaim = await client.gitIdentityRegistry.getLatestKeyClaim(address);
        if (!keyClaim || !keyClaim.publicKey || keyClaim.publicKey.trim() === '') {
          console.log(chalk.yellow(`  No registered key found for ${address}`));
          return null;
        }

        console.log(chalk.gray(`  Found key for ${address}: ${keyClaim.keyType === 0 ? 'PGP' : keyClaim.keyType === 1 ? 'SSH-Ed25519' : 'SSH-Secp256k1'}`));

        // Verify the GitKeyClaim signature
        const isValid = await verifyGitKeyClaimSignature(keyClaim, address);
        if (!isValid) {
          console.log(chalk.red(`  GitKeyClaim signature invalid for ${address}`));
          return null;
        }

        console.log(chalk.green(`  ✓ GitKeyClaim signature verified for ${address}`));

        return {
          keyType: keyClaim.keyType,
          publicKey: keyClaim.publicKey,
        };
      } catch (error) {
        console.error(chalk.red(`  Error fetching key for ${address}:`), error);
        return null;
      }
    };

    // Define the arbitration logic
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

      // Extract data
      const obligation = obligationData[0];
      const demand = demandData[0];
      const senderAddress = obligation.sender.toLowerCase() as `0x${string}`;

      console.log(`🔍 Fulfillment submitted by: ${senderAddress}`);
      console.log('📁 Repository configuration:');
      console.log(`   Test repo hosts: ${demand.hosts.join(', ')}`);
      console.log(`   Test commit: ${demand.testsCommitHash}`);
      console.log(`   Solution repo hosts: ${obligation.hosts.join(', ')}`);
      console.log(`   Solution commit: ${obligation.commitHash}`);

      // Run verification and tests
      console.log('\n🧪 Running verification and test execution...');

      const shouldVerify = !options.skipKeyVerification && hasGitIdentityRegistry;

      const result = await verifyAndRunTests({
        tests: {
          hosts: demand.hosts,
          commit: demand.testsCommitHash,
          // Don't verify test repo author (it's from the escrow creator)
        },
        source: {
          hosts: obligation.hosts,
          commit: obligation.commitHash,
          // Verify source repo was signed by the sender
          author: shouldVerify ? senderAddress : undefined,
        },
        getRegisteredKey: shouldVerify ? getRegisteredKey : undefined,
        timeout,
        cleanup,
      });

      console.log(`\n🎯 Result: ${result.success ? 'PASSED ✅' : 'FAILED ❌'}`);
      console.log(`   Framework used: ${result.frameworkUsed}`);
      console.log(`   Duration: ${result.duration}ms`);

      if (!result.success) {
        console.log('\n❌ Failure Details:');
        if (result.error) {
          console.log('   Error:', result.error);
        }
        if (result.output && result.output.trim()) {
          console.log('\n   Output:');
          console.log('   ' + '─'.repeat(70));
          const outputLines = result.output.split('\n');
          const linesToShow = outputLines.slice(-100);
          if (outputLines.length > 100) {
            console.log(`   ... (showing last 100 of ${outputLines.length} lines)`);
          }
          linesToShow.forEach(line => console.log('   ' + line));
          console.log('   ' + '─'.repeat(70));
        }
      }

      return result.success;
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
      process.exit(0);
    } else {
      console.log(chalk.yellow('Listening for new obligations and arbitrating...'));
      console.log(chalk.gray('Press Ctrl+C to stop the server\n'));

      let unwatchFn: (() => void) | null = null;

      process.on('SIGINT', async () => {
        console.log(chalk.yellow('\nShutting down server...'));
        if (unwatchFn) unwatchFn();
        console.log(chalk.green('✓ Server shutdown complete'));
        process.exit(0);
      });

      process.on('uncaughtException', (error) => {
        console.error(chalk.red('❌ Uncaught exception:'), error);
        if (error.message?.includes('WebSocket') || error.message?.includes('connection')) {
          console.log(chalk.yellow('⚠️ Connection error. Server will attempt to reconnect...'));
        } else {
          if (unwatchFn) unwatchFn();
          process.exit(1);
        }
      });

      process.on('unhandledRejection', (reason, promise) => {
        console.error(chalk.red('❌ Unhandled rejection:'), reason);
      });

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

      if (decisions.length > 0) {
        console.log(chalk.green(`✓ Processed ${decisions.length} past arbitration requests`));
      } else {
        console.log(chalk.gray('No past requests found. Waiting for new requests...'));
      }

      console.log(chalk.green('✓ Server is now listening...'));

      // Keep alive
      await new Promise<void>(() => {});
    }

  } catch (error) {
    console.error(chalk.red('Failed to start server:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
