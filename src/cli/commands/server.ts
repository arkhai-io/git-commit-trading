import chalk from 'chalk';
import { parseAbiParameters } from 'viem';
import { createClientFromEnv, requireEnvFile } from '../utils/envLoader.js';
import { GitTestExecution } from '../../test-execution/index.js';

interface ServerOptions {
  port?: string;
  pollingInterval?: string;
  timeout?: string;
  cleanup?: boolean;
  past?: boolean;
  listen?: boolean;
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

    console.log(chalk.gray('Server configuration:'));
    console.log(chalk.gray(`  Mode: ${options.past ? 'Arbitrate Past' : 'Listen and Arbitrate'}`));
    console.log(chalk.gray(`  Polling Interval: ${pollingInterval}ms`));
    console.log(chalk.gray(`  Test Timeout: ${timeout}ms`));
    console.log(chalk.gray(`  Cleanup: ${cleanup}`));

    // Check for .env file and load client
    requireEnvFile();
    
    console.log(chalk.gray('Setting up blockchain client...'));
    const { client, config, hasCommitObligation } = await createClientFromEnv();
    
    if (!hasCommitObligation) {
      throw new Error('COMMIT_OBLIGATION_ADDRESS is required in .env file for the server command');
    }

    console.log(chalk.green('Blockchain environment ready'));
    console.log(chalk.gray(`  Oracle Address: ${config.address}`));
    console.log(chalk.gray(`  CommitObligation Contract: ${config.commitObligationAddress}`));

    // Define the arbitration logic
    const arbitrate = async (obligation: any, demand: any) => {
      console.log("Arbitrating obligation:", obligation, "against demand:", demand);
      
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
        
        const result = await GitTestExecution.executeTests(testConfig, {
          onProgress: (step) => console.log(`  → ${step}`)
        });
        
        console.log("Execution result:", result.testResult.success);
        return result.testResult.success;
      } catch (error) {
        console.error("Error during test execution:", error);
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
        obligationAbi: parseAbiParameters("(string commitHash,uint8 commitAlgo,string[] hosts)"),
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
      await new Promise(() => {}); // This will run indefinitely until SIGINT
    }
    
  } catch (error) {
    console.error(chalk.red('Failed to start server:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
