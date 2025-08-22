import { existsSync, readFileSync } from 'fs';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http, nonceManager } from 'viem';
import { foundry, sepolia, mainnet } from 'viem/chains';
import { makeClient } from 'alkahest-ts';
import { makeCommitObligationClient, type CommitObligationAddresses } from '../../clients/commitObligation.js';
import chalk from 'chalk';

export interface EnvConfig {
  privateKey: string;
  address: string;
  network?: string;
  rpcUrl?: string;
  commitObligationAddress?: string;
}

/**
 * Load and parse .env file
 */
function loadEnvFile(envPath: string = '.env'): Record<string, string> {
  if (!existsSync(envPath)) {
    throw new Error(`Environment file ${envPath} not found. Please create a .env file with PRIVATE_KEY and ADDRESS.`);
  }

  const envContent = readFileSync(envPath, 'utf8');
  const envVars: Record<string, string> = {};

  for (const line of envContent.split('\n')) {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const [key, ...valueParts] = trimmedLine.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').replace(/^["']|["']$/g, ''); // Remove surrounding quotes
        envVars[key.trim()] = value.trim();
      }
    }
  }

  return envVars;
}

/**
 * Validate required environment variables
 */
function validateEnvConfig(envVars: Record<string, string>): EnvConfig {
  const privateKey = envVars.PRIVATE_KEY;
  const address = envVars.ADDRESS;

  if (!privateKey) {
    throw new Error('PRIVATE_KEY is required in .env file');
  }

  if (!address) {
    throw new Error('ADDRESS is required in .env file');
  }

  // Validate private key format
  if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
    throw new Error('PRIVATE_KEY must be a valid hex string starting with 0x and 64 characters long');
  }

  // Validate address format
  if (!address.startsWith('0x') || address.length !== 42) {
    throw new Error('ADDRESS must be a valid Ethereum address starting with 0x and 40 characters long');
  }

  return {
    privateKey,
    address,
    network: envVars.NETWORK || 'anvil',
    rpcUrl: envVars.RPC_URL,
    commitObligationAddress: envVars.COMMIT_OBLIGATION_ADDRESS,
  };
}

/**
 * Create a blockchain client from environment configuration
 */
export async function createClientFromEnv(envPath: string = '.env') {
  console.log(chalk.gray('Loading environment configuration...'));
  
  const envVars = loadEnvFile(envPath);
  const config = validateEnvConfig(envVars);

  console.log(chalk.green('✓ Environment configuration loaded'));
  console.log(chalk.gray(`  Address: ${config.address}`));

  const network = config.network || 'anvil';
  console.log(chalk.gray(`  Network: ${network}`));

  // Create account from private key
  const account = privateKeyToAccount(config.privateKey as `0x${string}`, {
    nonceManager,
  });

  // Verify that the private key matches the address
  if (account.address.toLowerCase() !== config.address.toLowerCase()) {
    throw new Error(`Private key does not match the provided address. Expected: ${config.address}, Got: ${account.address}`);
  }

  // Create wallet client based on network
  let walletClient;
  let rpcUrl = config.rpcUrl;

  switch (network.toLowerCase()) {
    case 'anvil':
    case 'localhost':
      rpcUrl = rpcUrl || 'http://127.0.0.1:8545';
      walletClient = createWalletClient({
        account,
        chain: foundry,
        transport: http(rpcUrl),
      });
      break;
    case 'sepolia':
      if (!rpcUrl) {
        throw new Error('RPC_URL is required for sepolia network in .env file');
      }
      walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: http(rpcUrl),
      });
      break;
    case 'mainnet':
      if (!rpcUrl) {
        throw new Error('RPC_URL is required for mainnet network in .env file');
      }
      walletClient = createWalletClient({
        account,
        chain: mainnet,
        transport: http(rpcUrl),
      });
      break;
    default:
      throw new Error(`Unsupported network: ${network}. Supported: anvil, localhost, sepolia, mainnet`);
  }

  console.log(chalk.gray(`  RPC URL: ${rpcUrl}`));

  // Create alkahest client
  const alkahestClient = makeClient(walletClient as any);

  // If commit obligation address is provided, extend the client
  if (config.commitObligationAddress) {
    console.log(chalk.gray(`  Commit Obligation: ${config.commitObligationAddress}`));
    
    const commitObligationAddresses: CommitObligationAddresses = {
      commitObligation: config.commitObligationAddress as `0x${string}`,
    };

    const extendedClient = alkahestClient.extend((client: any) => ({
      commitObligation: makeCommitObligationClient(client.viemClient, commitObligationAddresses),
    }));

    return {
      client: extendedClient,
      config,
      hasCommitObligation: true,
    };
  }

  return {
    client: alkahestClient,
    config,
    hasCommitObligation: false,
  };
}

/**
 * Check if .env file exists and show helpful error message if not
 */
export function requireEnvFile(envPath: string = '.env'): void {
  if (!existsSync(envPath)) {
    console.error(chalk.red('❌ .env file not found'));
    console.error(chalk.yellow('\nPlease create a .env file with the following format:'));
    console.error(chalk.gray('PRIVATE_KEY=0x1234567890abcdef...'));
    console.error(chalk.gray('ADDRESS=0xYourEthereumAddress'));
    console.error(chalk.gray('NETWORK=anvil  # optional: anvil, localhost, sepolia, mainnet'));
    console.error(chalk.gray('RPC_URL=http://127.0.0.1:8545  # optional for anvil/localhost'));
    console.error(chalk.gray('COMMIT_OBLIGATION_ADDRESS=0x...  # optional'));
    console.error(chalk.yellow('\nExample .env file:'));
    console.error(chalk.cyan(`PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
NETWORK=anvil
RPC_URL=http://127.0.0.1:8545`));
    process.exit(1);
  }
}
