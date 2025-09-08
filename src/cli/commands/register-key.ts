import chalk from 'chalk';
import { readFileSync, existsSync } from 'fs';
import { createClientFromEnv, requireEnvFile, validateGitKeyEnv } from '../utils/envLoader.js';
import { extractSSHKeyMaterial } from '../../utils/gitUtils.js';
import { KeyType, createGitKeyClaim } from '../../clients/gitIdentityRegistry.js';
import { generateSigningMessage, generateSSHSignature } from '../../utils/sshSignatureUtils.js';
import sshpk from 'sshpk';

interface RegisterKeyOptions {
  path?: string;
  keyType?: string;
  privateKeyFile?: string;
  publicKeyFile?: string;
}

/**
 * Auto-detect key type from SSH public key
 */
function detectKeyType(sshPublicKey: string): KeyType {
  if (sshPublicKey.includes('ssh-ed25519')) {
    return KeyType.SSHEd25519;
  } else if (sshPublicKey.includes('ssh-rsa')) {
    return KeyType.SSHSecp256k1;
  } else if (sshPublicKey.includes('ssh-dss')) {
    return KeyType.SSHSecp256k1; // DSA keys treated as Secp256k1
  } else if (sshPublicKey.includes('ecdsa-sha2-')) {
    return KeyType.SSHSecp256k1; // ECDSA keys treated as Secp256k1  
  } else {
    throw new Error('Unsupported SSH key type. Supported: ssh-ed25519, ssh-rsa, ssh-dss, ecdsa-sha2-*');
  }
}

/**
 * Read SSH public key from various sources
 */
function readSSHPublicKey(options: RegisterKeyOptions): string {
  let publicKeyPath: string;

  // Priority: --public-key-file > --path > ~/.ssh/id_ed25519.pub > ~/.ssh/id_rsa.pub
  if (options.publicKeyFile) {
    publicKeyPath = options.publicKeyFile;
  } else if (options.path) {
    publicKeyPath = options.path;
  } else {
    // Try common SSH key locations
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    if (!homeDir) {
      throw new Error('Could not determine home directory');
    }

    const commonPaths = [
      `${homeDir}/.ssh/id_ed25519.pub`,
      `${homeDir}/.ssh/id_rsa.pub`,
      `${homeDir}/.ssh/id_ecdsa.pub`,
      `${homeDir}/.ssh/id_dsa.pub`
    ];

    publicKeyPath = commonPaths.find(path => existsSync(path)) || '';
    
    if (!publicKeyPath) {
      throw new Error('No SSH public key found. Use --path to specify the key file location, or generate SSH keys with: ssh-keygen -t ed25519');
    }
  }

  if (!existsSync(publicKeyPath)) {
    throw new Error(`SSH public key file not found: ${publicKeyPath}`);
  }

  const publicKeyContent = readFileSync(publicKeyPath, 'utf8').trim();
  if (!publicKeyContent) {
    throw new Error(`SSH public key file is empty: ${publicKeyPath}`);
  }

  return publicKeyContent;
}

/**
 * Read SSH private key for signing
 */
function readSSHPrivateKey(options: RegisterKeyOptions, publicKeyPath?: string): string {
  let privateKeyPath: string;

  if (options.privateKeyFile) {
    privateKeyPath = options.privateKeyFile;
  } else if (options.path && options.path.endsWith('.pub')) {
    // If public key path is provided, try corresponding private key
    privateKeyPath = options.path.replace('.pub', '');
  } else if (publicKeyPath && publicKeyPath.endsWith('.pub')) {
    privateKeyPath = publicKeyPath.replace('.pub', '');
  } else {
    // Try common SSH private key locations
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    if (!homeDir) {
      throw new Error('Could not determine home directory');
    }

    const commonPaths = [
      `${homeDir}/.ssh/id_ed25519`,
      `${homeDir}/.ssh/id_rsa`,
      `${homeDir}/.ssh/id_ecdsa`, 
      `${homeDir}/.ssh/id_dsa`
    ];

    privateKeyPath = commonPaths.find(path => existsSync(path)) || '';
    
    if (!privateKeyPath) {
      throw new Error('No SSH private key found for signing. Use --private-key-file to specify the private key location.');
    }
  }

  if (!existsSync(privateKeyPath)) {
    throw new Error(`SSH private key file not found: ${privateKeyPath}`);
  }

  const privateKeyContent = readFileSync(privateKeyPath, 'utf8').trim();
  if (!privateKeyContent) {
    throw new Error(`SSH private key file is empty: ${privateKeyPath}`);
  }

  return privateKeyContent;
}

export async function registerKeyCommand(options: RegisterKeyOptions) {
  try {
    console.log(chalk.blue('Registering Git SSH key with blockchain...'));
    
    // Validate .env has all required fields for Git Key operations
    validateGitKeyEnv();
    
    console.log(chalk.gray('Setting up blockchain client...'));
    const { client, config } = await createClientFromEnv();
    
    // Read SSH public key
    console.log(chalk.gray('Reading SSH public key...'));
    const sshPublicKey = readSSHPublicKey(options);
    console.log(chalk.gray(`Found SSH key: ${sshPublicKey.substring(0, 50)}...`));
    
    // Detect key type
    const keyType = detectKeyType(sshPublicKey);
    console.log(chalk.gray(`Detected key type: ${KeyType[keyType]}`));
    
    // Extract key material
    const keyMaterial = extractSSHKeyMaterial(sshPublicKey);
    console.log(chalk.gray(`Key material length: ${keyMaterial.length} characters`));
    
    // Generate nonce and signing message
    const nonce = `register_key_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const nonceHash = Buffer.from(nonce).toString('hex').padStart(64, '0');
    const signingMessage = generateSigningMessage(config.address as `0x${string}`, nonce);
    
    console.log(chalk.gray('Generating signature...'));
    console.log(chalk.gray(`Nonce: ${nonce}`));
    console.log(chalk.gray(`Signing message: ${signingMessage}`));
    
    // Read private key and generate signature
    const privateKeyContent = readSSHPrivateKey(options, options.path);
    const signature = generateSSHSignature(privateKeyContent, signingMessage);
    
    console.log(chalk.gray(`Generated signature: ${signature.substring(0, 32)}...`));
    
    // Create the Git key claim
    const gitKeyClaim = createGitKeyClaim(keyType, nonceHash, signature, keyMaterial);
    
    console.log(chalk.gray('Submitting key registration to blockchain...'));
    
    // Check if client has gitIdentityRegistry
    if (!client.gitIdentityRegistry) {
      throw new Error('GitIdentityRegistry is not available. Please ensure GIT_IDENTITY_REGISTRY_ADDRESS is set in .env');
    }
    
    // Submit the key claim to blockchain
    const result = await client.gitIdentityRegistry.claimKey(gitKeyClaim);
    
    console.log(chalk.green('✅ Git SSH key registered successfully!'));
    console.log(chalk.white('Registration Details:'));
    console.log(chalk.gray(`  Transaction Hash: ${result.hash}`));
    console.log(chalk.gray(`  Key Type: ${KeyType[keyType]}`));
    console.log(chalk.gray(`  Public Key: ${keyMaterial.substring(0, 32)}...`));
    console.log(chalk.gray(`  Ethereum Address: ${config.address}`));
    console.log(chalk.gray(`  Nonce: ${nonce}`));
    
    console.log(chalk.yellow('\nNext steps:'));
    console.log(chalk.yellow('  1. Your Git commits signed with this SSH key are now linked to your Ethereum address'));
    console.log(chalk.yellow('  2. You can now fulfill escrows and prove authorship of commits'));
    console.log(chalk.yellow('  3. Use this same key to sign Git commits for escrow fulfillments'));

  } catch (error) {
    console.error(chalk.red('❌ Failed to register Git SSH key:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    
    // Provide helpful debugging info
    console.log(chalk.yellow('\nTroubleshooting:'));
    console.log(chalk.yellow('  1. Ensure you have SSH keys generated: ssh-keygen -t ed25519'));
    console.log(chalk.yellow('  2. Check that your .env file contains GIT_IDENTITY_REGISTRY_ADDRESS'));
    console.log(chalk.yellow('  3. Verify your private key has sufficient gas for the transaction'));
    console.log(chalk.yellow('  4. Use --path to specify exact SSH key file location if auto-detection fails'));
    
    process.exit(1);
  }
}
