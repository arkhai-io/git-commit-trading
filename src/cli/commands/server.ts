import chalk from 'chalk';
import { parseAbiParameters } from 'viem';
import { setupTest } from '../../../tests/utils/setup.js';
import { GitTestExecution } from '../../test-execution/index.js';

interface ServerOptions {
  port?: string;
  pollingInterval?: string;
  timeout?: string;
  cleanup?: boolean;
}

export async function serverCommand(options: ServerOptions) {
  try {
    console.log(chalk.blue('Starting Git Escrows Arbiter Server...'));
    
    const port = parseInt(options.port || '3000');
    const pollingInterval = parseInt(options.pollingInterval || '1000');
    const timeout = parseInt(options.timeout || '300000');
    const cleanup = options.cleanup !== false;

    console.log(chalk.gray('Server configuration:'));
    console.log(chalk.gray(`  Port: ${port}`));
    console.log(chalk.gray(`  Polling Interval: ${pollingInterval}ms`));
    console.log(chalk.gray(`  Test Timeout: ${timeout}ms`));
    console.log(chalk.gray(`  Cleanup: ${cleanup}`));

    // Setup test environment (this will initialize Charlie's arbiter client)
    console.log(chalk.gray('Setting up blockchain environment...'));
    const setup = await setupTest();
    const arbiterClient = setup.testContext.charlieClient;
    const testContext = setup.testContext;
    const commitObligationAddress = setup.commitObligationAddress;

    console.log(chalk.green('Blockchain environment ready'));
    console.log(chalk.gray(`  Oracle Address: ${testContext.charlie}`));
    console.log(chalk.gray(`  CommitObligation Contract: ${commitObligationAddress}`));

    console.log(chalk.yellow('Starting to listen for escrows...'));
    console.log(chalk.gray('Press Ctrl+C to stop the server'));

    // Start listening for escrows and arbitrating them
    const { unwatch } = await arbiterClient.oracle.listenAndArbitrateForEscrow({
      escrow: {
        attester: testContext.addresses.erc20EscrowObligation,
        demandAbi: parseAbiParameters("(string testsCommitHash, string testsCommand, uint8 testsCommitAlgo, string[] hosts)"),
      },
      fulfillment: {
        attester: commitObligationAddress,
        obligationAbi: parseAbiParameters("(string commitHash,uint8 commitAlgo,string[] hosts)"),
      },
      arbitrate: async (obligation: any, demand: any) => {
        console.log(chalk.cyan('\nNew arbitration request received'));
        console.log(chalk.gray('Obligation data:'), obligation[0]);
        console.log(chalk.gray('Demand data:'), demand[0]);
        
        try {
          console.log(chalk.yellow('Setting up test execution...'));
          
          // Initialize test configuration
          const config = GitTestExecution.initConfig();
          
          // Configure test case repository (Alice's tests)
          config.repositories.testcase.url = demand[0].hosts[0];
          config.repositories.testcase.commitHash = demand[0].testsCommitHash;
          config.repositories.testcase.buildCommand = "npm run build";
          config.repositories.testcase.testCommand = demand[0].testsCommand;
          config.repositories.testcase.installCommand = "npm install";

          // Configure source repository (Bob's solution)
          config.repositories.source.url = obligation[0].hosts[0];
          config.repositories.source.commitHash = obligation[0].commitHash;
          config.repositories.source.installCommand = "npm install";

          // Configure execution settings
          config.execution.timeout = timeout;
          config.execution.cleanupAfterExecution = cleanup;
          config.execution.tempDirectory = './temp';

          console.log(chalk.gray('Execution configuration:'));
          console.log(chalk.gray(`  Test Repo: ${config.repositories.testcase.url}`));
          console.log(chalk.gray(`  Test Commit: ${config.repositories.testcase.commitHash}`));
          console.log(chalk.gray(`  Test Command: ${config.repositories.testcase.testCommand}`));
          console.log(chalk.gray(`  Solution Repo: ${config.repositories.source.url}`));
          console.log(chalk.gray(`  Solution Commit: ${config.repositories.source.commitHash}`));

          console.log(chalk.yellow('Executing tests...'));
          
          const result = await GitTestExecution.executeTests(config, {
            onProgress: (step) => console.log(chalk.gray(`  ${step}`))
          });

          const success = result.testResult.success;
          
          if (success) {
            console.log(chalk.green('Tests passed! Fulfillment approved.'));
          } else {
            console.log(chalk.red('Tests failed! Fulfillment rejected.'));
            console.log(chalk.red('Error output:'));
            console.log(chalk.red(result.testResult.error || result.testResult.output));
          }
          
          console.log(chalk.gray(`Test execution duration: ${result.testResult.duration}ms`));
          console.log(chalk.gray(`Cleanup performed: ${result.cleanup}`));
          
          return success;
          
        } catch (error) {
          console.error(chalk.red('Error during test execution:'));
          console.error(chalk.red(error instanceof Error ? error.message : String(error)));
          
          // Return false on error to reject the fulfillment
          return false;
        }
      },
      onAfterArbitrate: async (decision: boolean) => {
        if (decision) {
          console.log(chalk.green('Arbitration completed: APPROVED'));
        } else {
          console.log(chalk.red('Arbitration completed: REJECTED'));
        }
        console.log(chalk.yellow('Continuing to listen for new escrows...\n'));
      },
      pollingInterval: pollingInterval,
    });

    // Handle graceful shutdown
    const shutdown = () => {
      console.log(chalk.yellow('\nShutting down server...'));
      unwatch();
      console.log(chalk.green('Server stopped gracefully'));
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep the server running
    console.log(chalk.green(`Server is running and listening for escrows...`));
    
  } catch (error) {
    console.error(chalk.red('Failed to start server:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
