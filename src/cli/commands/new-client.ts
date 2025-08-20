import chalk from 'chalk';
import { writeFileSync, existsSync } from 'fs';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http, nonceManager } from 'viem';
import { foundry } from 'viem/chains';
import { makeClient } from 'alkahest-ts';
import { makeCommitObligationClient, type CommitObligationAddresses } from '../../clients/commitObligation.js';
import { setupTest } from '../../../tests/utils/setup.js';
import CommitObligation from '@contracts/CommitObligation.json';

interface NewClientOptions {
  privateKey: string;
  network: string;
  output?: string;
}

export interface ClientInfo {
  privateKey: string;
  network: string;
  address: string;
  commitObligationAddress?: string;
  timestamp: string;
}

export async function newClientCommand(options: NewClientOptions) {
  try {
    console.log(chalk.blue('🔑 Initializing new client...'));
    
    // Validate inputs
    if (!options.privateKey || !options.network) {
      throw new Error('Missing required options: --privateKey, --network');
    }

    // Validate private key format
    if (!options.privateKey.startsWith('0x') || options.privateKey.length !== 66) {
      throw new Error('Invalid private key format. Must be 64 hex characters starting with 0x');
    }

    const outputFile = options.output || 'client_info.json';

    // Check if client_info.json already exists
    if (existsSync(outputFile)) {
      console.log(chalk.yellow(`⚠️  ${outputFile} already exists. Overwriting...`));
    }

    let commitObligationAddress: string | undefined;
    let account: any;

    // Create account from private key
    account = privateKeyToAccount(options.privateKey as `0x${string}`, {
      nonceManager,
    });

    console.log(chalk.gray(`Setting up client for address: ${account.address}`));

    if (options.network.toLowerCase() === 'anvil') {
      // For anvil network, use the test setup to get the deployed contract
      console.log(chalk.gray('Using Anvil network with test environment...'));
      const setup = await setupTest();
      commitObligationAddress = setup.commitObligationAddress;
      
      // For anvil, we'll just store the configuration and let the loader handle client creation
      console.log(chalk.green('✅ Anvil setup complete'));

    } else {
      // For other networks, we'll just store the basic configuration
      console.log(chalk.gray(`Setting up client for network: ${options.network}`));
      
      // For now, we'll just create the basic client structure
      // In a real implementation, you'd need to handle different networks
      // and potentially deploy the CommitObligation contract
      
      switch (options.network.toLowerCase()) {
        case 'localhost':
          console.log(chalk.gray('Using localhost network'));
          break;
        case 'sepolia':
          // You would configure sepolia here
          throw new Error('Sepolia network configuration not implemented yet');
        case 'mainnet':
          // You would configure mainnet here
          throw new Error('Mainnet network configuration not implemented yet');
        default:
          throw new Error(`Unsupported network: ${options.network}`);
      }
      
      console.log(chalk.yellow('⚠️  CommitObligation contract not deployed for this network. You may need to deploy it manually.'));
    }

    // Create client info object
    const clientInfo: ClientInfo = {
      privateKey: options.privateKey,
      network: options.network,
      address: account.address,
      commitObligationAddress,
      timestamp: new Date().toISOString(),
    };

    // Save to file
    writeFileSync(outputFile, JSON.stringify(clientInfo, null, 2));

    console.log(chalk.green('✅ Client initialized successfully!'));
    console.log(chalk.gray(`📁 Client configuration saved to: ${outputFile}`));
    console.log(chalk.gray(`👤 Address: ${account.address}`));
    console.log(chalk.gray(`🌐 Network: ${options.network}`));
    if (commitObligationAddress) {
      console.log(chalk.gray(`📝 CommitObligation Contract: ${commitObligationAddress}`));
    }
    
    console.log(chalk.gray('✨ Use this configuration with other commands by having client_info.json in your working directory.'));

    // Exit successfully
    process.exit(0);

  } catch (error) {
    console.error(chalk.red('❌ Failed to initialize client:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
