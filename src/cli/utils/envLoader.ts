import { existsSync, readFileSync } from 'fs';
import { privateKeyToAccount, nonceManager } from 'viem/accounts';
import { createWalletClient, http, webSocket, publicActions } from 'viem';
import { foundry, sepolia, mainnet, baseSepolia } from 'viem/chains';
import { makeClient } from 'alkahest-ts';
import { makeCommitObligationClient, type CommitObligationAddresses } from '../../clients/commitObligation.js';
import { makeGitIdentityRegistryClient, type GitIdentityRegistryAddresses } from '../../clients/gitIdentityRegistry.js';
import chalk from 'chalk';

export interface EnvConfig {
  privateKey: string;
  address: string;
  network?: string;
  rpcUrl?: string;
  wsRpcUrl?: string;
  commitObligationAddress?: string;
  gitIdentityRegistryAddress?: string;
  // DEBUG=true enables verbose logging with trace IDs
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
    wsRpcUrl: envVars.WS_RPC_URL,
    commitObligationAddress: envVars.COMMIT_OBLIGATION_ADDRESS,
    gitIdentityRegistryAddress: envVars.GIT_IDENTITY_REGISTRY_ADDRESS,
  };
}

/**
 * Create a blockchain client from environment configuration
 */
export async function createClientFromEnv(envPath: string = '.env', transportType: 'http' | 'websocket' = 'http') {
  console.log(chalk.gray('Loading environment configuration...'));
  
  const envVars = loadEnvFile(envPath);
  const config = validateEnvConfig(envVars);

  console.log(chalk.green('✓ Environment configuration loaded'));
  console.log(chalk.gray(`  Address: ${config.address}`));

  const network = config.network || 'anvil';
  console.log(chalk.gray(`  Network: ${network}`));
  console.log(chalk.gray(`  Transport: ${transportType.toUpperCase()}`));
  
  if (transportType === 'websocket' && config.wsRpcUrl) {
    console.log(chalk.gray(`  WebSocket URL: ${config.wsRpcUrl.substring(0, 40)}...`));
  }

  // Create account from private key
  const account = privateKeyToAccount(config.privateKey as `0x${string}`);

  // Verify that the private key matches the address
  if (account.address.toLowerCase() !== config.address.toLowerCase()) {
    throw new Error(`Private key does not match the provided address. Expected: ${config.address}, Got: ${account.address}`);
  }

  // Helper to create transport based on type
  const createTransport = (httpUrl: string) => {
    if (transportType === 'websocket') {
      // Use WS_RPC_URL if available, otherwise convert HTTP URL to WebSocket
      let wsUrl = config.wsRpcUrl;
      
      if (!wsUrl) {
        // Fallback: convert http/https URLs to ws/wss
        wsUrl = httpUrl.replace(/^http/, 'ws');
        console.log(chalk.yellow(`⚠️ WS_RPC_URL not found in .env, converting HTTP URL to WebSocket: ${wsUrl}`));
      }
      
      return webSocket(wsUrl, {
        keepAlive: true,
        timeout: 60_000, // 60 seconds timeout
        reconnect: {
          attempts: 10,
          delay: 3000, // 3 seconds between attempts
        },
      });
    }
    return http(httpUrl);
  };

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
        transport: createTransport(rpcUrl),
      });
      break;
    case 'sepolia':
      if (!rpcUrl) {
        throw new Error('RPC_URL is required for sepolia network in .env file');
      }
      walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: createTransport(rpcUrl),
      });
      break;
    case 'basesepolia':
    case 'base-sepolia':
      if (!rpcUrl) {
        throw new Error('RPC_URL is required for base-sepolia network in .env file');
      }
      walletClient = createWalletClient({
        account,
        chain: baseSepolia,
        transport: createTransport(rpcUrl),
      });
      break;
    case 'mainnet':
      if (!rpcUrl) {
        throw new Error('RPC_URL is required for mainnet network in .env file');
      }
      walletClient = createWalletClient({
        account,
        chain: mainnet,
        transport: createTransport(rpcUrl),
      });
      break;
    default:
      throw new Error(`Unsupported network: ${network}. Supported: anvil, localhost, sepolia, base-sepolia, mainnet`);
  }

  console.log(chalk.gray(`  RPC URL: ${rpcUrl?.substring(0, 40)}...`));

  // Create alkahest client
  const alkahestClient = makeClient(walletClient as any);

  // Build extensions object for the client
  const extensions: any = {};
  let hasExtensions = false;

  // Add CommitObligation if available
  if (config.commitObligationAddress) {
    console.log(chalk.gray(`  Commit Obligation: ${config.commitObligationAddress}`));
    
    const commitObligationAddresses: CommitObligationAddresses = {
      commitObligation: config.commitObligationAddress as `0x${string}`,
    };
    
    extensions.commitObligation = (client: any) => makeCommitObligationClient(client.viemClient, commitObligationAddresses);
    hasExtensions = true;
  }

  // Add GitIdentityRegistry if available
  if (config.gitIdentityRegistryAddress) {
    console.log(chalk.gray(`  Git Identity Registry: ${config.gitIdentityRegistryAddress}`));
    
    const gitIdentityRegistryAddresses: GitIdentityRegistryAddresses = {
      gitIdentityRegistry: config.gitIdentityRegistryAddress as `0x${string}`,
    };
    
    extensions.gitIdentityRegistry = (client: any) => makeGitIdentityRegistryClient(client.viemClient, gitIdentityRegistryAddresses);
    hasExtensions = true;
  }

  // Extend client if we have any extensions
  if (hasExtensions) {
    const extendedClient = alkahestClient.extend((client: any) => {
      const result: any = {};
      Object.keys(extensions).forEach(key => {
        result[key] = extensions[key](client);
      });
      return result;
    });

    return {
      client: extendedClient,
      config,
      hasCommitObligation: !!config.commitObligationAddress,
      hasGitIdentityRegistry: !!config.gitIdentityRegistryAddress,
    };
  }

  return {
    client: alkahestClient,
    config,
    hasCommitObligation: false,
    hasGitIdentityRegistry: false,
  };
}

/**
 * Check if .env file exists, load it into process.env, and show helpful error message if not found
 */
export function requireEnvFile(envPath: string = '.env'): void {
  if (!existsSync(envPath)) {
    console.error(chalk.red('❌ .env file not found'));
    console.error(chalk.yellow('\nPlease create a .env file with the following format:'));
    console.error(chalk.gray('PRIVATE_KEY=0x1234567890abcdef...'));
    console.error(chalk.gray('ADDRESS=0xYourEthereumAddress'));
    console.error(chalk.gray('NETWORK=anvil  # optional: anvil, localhost, sepolia, base-sepolia, mainnet'));
    console.error(chalk.gray('RPC_URL=http://127.0.0.1:8545  # optional for anvil/localhost'));
    console.error(chalk.gray('COMMIT_OBLIGATION_ADDRESS=0x...  # optional'));
    console.error(chalk.gray('GIT_IDENTITY_REGISTRY_ADDRESS=0x...  # optional'));
    console.error(chalk.gray('DEBUG=true  # optional: enable verbose logging'));
    console.error(chalk.yellow('\nExample .env file:'));
    console.error(chalk.cyan(`PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
NETWORK=anvil
RPC_URL=http://127.0.0.1:8545
GIT_IDENTITY_REGISTRY_ADDRESS=0x...
DEBUG=true`));
    process.exit(1);
  }
  
  // Load environment variables into process.env for use throughout the application
  const envVars = loadEnvFile(envPath);
  for (const [key, value] of Object.entries(envVars)) {
    // Don't override existing process.env variables (system env takes priority)
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

/**
 * Check if .env has all required fields for Git Key operations (register-key, check-key)
 */
export function validateGitKeyEnv(envPath: string = '.env'): void {
  requireEnvFile(envPath);
  
  try {
    const env = loadEnvFile(envPath);
    const missing: string[] = [];
    
    if (!env.PRIVATE_KEY) missing.push('PRIVATE_KEY');
    if (!env.ADDRESS) missing.push('ADDRESS');
    if (!env.GIT_IDENTITY_REGISTRY_ADDRESS || env.GIT_IDENTITY_REGISTRY_ADDRESS.startsWith('#')) {
      missing.push('GIT_IDENTITY_REGISTRY_ADDRESS');
    }
    
    if (missing.length > 0) {
      console.error(chalk.red('❌ Missing required environment variables for Git Key operations:'));
      missing.forEach(field => console.error(chalk.red(`   - ${field}`)));
      console.error(chalk.yellow('\nPlease update your .env file or generate a new one with:'));
      console.error(chalk.cyan('git-escrows new-client --privateKey 0x... --network anvil'));
      console.error(chalk.yellow('\nThen add the deployed GitIdentityRegistry contract address.'));
      process.exit(1);
    }
    
    console.log(chalk.green('✅ Environment validated for Git Key operations'));
  } catch (error) {
    console.error(chalk.red('❌ Failed to validate .env file:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
