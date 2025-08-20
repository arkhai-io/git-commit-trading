import { readFileSync, existsSync } from 'fs';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http, nonceManager } from 'viem';
import { foundry } from 'viem/chains';
import { makeClient } from 'alkahest-ts';
import { makeCommitObligationClient, type CommitObligationAddresses } from '../../clients/commitObligation.js';
import { setupTest } from '../../../tests/utils/setup.js';
import chalk from 'chalk';

export interface ClientInfo {
  privateKey: string;
  network: string;
  address: string;
  commitObligationAddress?: string;
  timestamp: string;
}

export async function loadClientFromConfig(configFile: string = 'client_info.json') {
  if (!existsSync(configFile)) {
    return null;
  }

  try {
    const clientInfo: ClientInfo = JSON.parse(readFileSync(configFile, 'utf8'));
    
    // Create account from stored private key
    const account = privateKeyToAccount(clientInfo.privateKey as `0x${string}`, {
      nonceManager,
    });

    let walletClient;
    let commitObligationAddress = clientInfo.commitObligationAddress;

    // Set up network transport based on stored network
    switch (clientInfo.network.toLowerCase()) {
      case 'anvil':
      case 'localhost':
        walletClient = createWalletClient({
          account,
          chain: foundry,
          transport: http('http://127.0.0.1:8545'),
        });
        break;
      case 'sepolia':
        // Configure for sepolia if needed
        throw new Error('Sepolia network configuration not implemented yet');
      case 'mainnet':
        // Configure for mainnet if needed
        throw new Error('Mainnet network configuration not implemented yet');
      default:
        throw new Error(`Unsupported network: ${clientInfo.network}`);
    }

    // Create alkahest client
    // Note: We need to handle type compatibility issues between different viem versions
    // For now, we'll use the test setup when possible and create a basic client otherwise
    let alkahestClient;
    
    try {
      alkahestClient = makeClient(walletClient as any);
    } catch (error) {
      console.error('Failed to create alkahest client directly, falling back to test setup');
      throw error;
    }

    // If we have a commit obligation address, extend the client
    if (commitObligationAddress) {
      const commitObligationAddresses: CommitObligationAddresses = {
        commitObligation: commitObligationAddress as `0x${string}`,
      };
      
      return alkahestClient.extend((client: any) => ({
        commitObligation: makeCommitObligationClient(client.viemClient, commitObligationAddresses),
      }));
    }

    return alkahestClient;
  } catch (error) {
    throw new Error(`Failed to load client from ${configFile}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function getClientOrSetupTest(configFile: string = 'client_info.json') {
  // First try to load from config file
  if (existsSync(configFile)) {
    try {
      const clientInfo: ClientInfo = JSON.parse(readFileSync(configFile, 'utf8'));
      
      // For anvil network, we need to use the test setup to ensure contracts are deployed
      if (clientInfo.network.toLowerCase() === 'anvil') {
        console.log(chalk.yellow('⚠️  Anvil network detected in config, using test environment for proper setup'));
        const setup = await setupTest();
        return {
          ...setup,
          isFromConfig: true,
          clientInfo,
        };
      }
      
      // For other networks, try to create the client from config
      const clientFromConfig = await loadClientFromConfig(configFile);
      if (clientFromConfig) {
        return {
          aliceClient: clientFromConfig,
          bobClient: clientFromConfig, // For now, use same client for both
          testContext: null, // No test context when using real config
          isFromConfig: true,
          clientInfo,
        };
      }
    } catch (error) {
      console.log(chalk.yellow(`⚠️  Failed to load from ${configFile}: ${error instanceof Error ? error.message : String(error)}`));
      console.log(chalk.yellow('⚠️  Falling back to test environment'));
    }
  }

  // Fallback to test setup
  const setup = await setupTest();
  return {
    ...setup,
    isFromConfig: false,
    clientInfo: null,
  };
}
