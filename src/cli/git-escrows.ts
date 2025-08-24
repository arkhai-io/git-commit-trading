#!/usr/bin/env bun

import { Command } from 'commander';
import chalk from 'chalk';
import { submitCommand } from './commands/submit.js';
import { fulfillCommand } from './commands/fulfill.js';
import { serverCommand } from './commands/server.js';
import { collectCommand } from './commands/collect.js';
import { listCommand } from './commands/list.js';
import { newClientCommand } from './commands/new-client.js';

const program = new Command();

program
  .name('git-escrows')
  .description('Git-based escrow system for code challenges and bounties')
  .version('1.0.0');

// New Client command - Initialize a client with .env configuration
program
  .command('new-client')
  .description('Create a .env file with private key and network configuration')
  .requiredOption('--privateKey <key>', 'Private key for the client (0x...)')
  .requiredOption('--network <network>', 'Network to connect to (anvil, localhost, sepolia, mainnet)')
  .action(newClientCommand);

// List command - Show all available escrows
program
  .command('list')
  .description('List all available escrows')
  .option('--status <status>', 'Filter by status (open, fulfilled, completed)')
  .option('--limit <number>', 'Maximum number of escrows to show', '20')
  .option('--format <format>', 'Output format (table, json, csv)', 'table')
  .option('--verbose', 'Show detailed information', false)
  .action(listCommand);

// Submit command - Alice creates a new demand
program
  .command('submit')
  .description('Create a new escrow demand for a coding challenge')
  .requiredOption('--tests-repo <url>', 'Git repository URL containing test cases')
  .requiredOption('--tests-commit <hash>', 'Commit hash of the test cases')
  .requiredOption('--reward <amount>', 'Reward amount in tokens')
  .option('--tests-command <cmd>', 'Command to run tests', 'npm test')
  .option('--tests-algo <algo>', 'Commit hash algorithm', 'sha1')
  .option('--arbiter <address>', 'Arbiter contract address')
  .option('--oracle <address>', 'Oracle address for arbitration')
  .option('--token <address>', 'ERC20 token contract address')
  .action(submitCommand);

// Fulfill command - Bob submits a solution
program
  .command('fulfill')
  .description('Submit a solution to fulfill an escrow demand')
  .requiredOption('--escrow-uid <uid>', 'Escrow UID to fulfill')
  .requiredOption('--solution-repo <url>', 'Git repository URL containing the solution')
  .requiredOption('--solution-commit <hash>', 'Commit hash of the solution')
  .option('--solution-algo <algo>', 'Commit hash algorithm', 'sha1')
  .option('--additional-hosts <hosts>', 'Additional host URLs (comma-separated)')
  .action(fulfillCommand);

// Collect command - Bob collects the reward
program
  .command('collect')
  .description('Collect the reward from a fulfilled escrow')
  .requiredOption('--escrow-uid <uid>', 'Escrow UID to collect from')
  .requiredOption('--fulfillment-uid <uid>', 'Fulfillment UID that was approved')
  .action(collectCommand);

// Server command - Charlie runs the arbiter server
program
  .command('server')
  .description('Run the arbiter server to listen and arbitrate escrows')
  .option('--past', 'Arbitrate past obligations and exit')
  .option('--listen', 'Listen for new obligations and arbitrate continuously')
  .option('--port <port>', 'Server port (deprecated)', '3000')
  .option('--polling-interval <ms>', 'Polling interval for new escrows (ms)', '1000')
  .option('--timeout <ms>', 'Test execution timeout (ms)', '300000')
  .option('--cleanup', 'Cleanup temporary directories after execution', true)
  .action(serverCommand);

// Global error handling
program.on('command:*', () => {
  console.error(chalk.red(`Invalid command: ${program.args.join(' ')}`));
  console.log('See --help for a list of available commands.');
  process.exit(1);
});

// Parse command line arguments
program.parse();
