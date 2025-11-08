import chalk from 'chalk';
import { readFileSync, existsSync, statSync } from 'fs';
import { createClientFromEnv, requireEnvFile, validateGitKeyEnv } from '../utils/envLoader.js';
import { extractSSHKeyMaterial } from '../../utils/gitUtils.js';
import { KeyType, createGitKeyClaim } from '../../clients/gitIdentityRegistry.js';
import { generateSigningMessage, generateSSHSignature } from '../../utils/sshSignatureUtils.js';
import { 
    detectKeyTypeFromContent, 
    formatKeyForStorage, 
    validateKeyForGitSigning,
    getKeyTypeName,
    importSSHKeyToServer,
    importGPGKeyToServer,
    isSSHKeyImported,
    isGPGKeyImported,
    generatePGPSignature,
    preparePGPKeyForRegistration,
    extractPGPKeyMaterial
} from '../../utils/keyUtils.js';
import sshpk from 'sshpk';

interface RegisterKeyOptions {
  path?: string;
  keyType?: string;
  privateKeyFile?: string;
  publicKeyFile?: string;
  pgpKeyFile?: string;
  pgpPrivateKeyFile?: string;
  pgpPassphrase?: string;
  x509CertFile?: string;
  importToServer?: boolean;
  skipServerImport?: boolean;
}

/**
 * Auto-detect key type from key content using enhanced detection
 */
function detectKeyType(keyContent: string): KeyType {
  try {
    return detectKeyTypeFromContent(keyContent);
  } catch (error) {
    // Fallback to legacy SSH detection
    if (keyContent.includes('ssh-ed25519')) {
      return KeyType.SSHEd25519;
    } else if (keyContent.includes('ssh-rsa')) {
      return KeyType.SSHSecp256k1;
    } else if (keyContent.includes('ssh-dss')) {
      return KeyType.SSHSecp256k1; // DSA keys treated as Secp256k1
    } else if (keyContent.includes('ecdsa-sha2-')) {
      return KeyType.SSHSecp256k1; // ECDSA keys treated as Secp256k1
    } else {
      throw new Error('Unsupported key type. Supported: SSH (ed25519, rsa, ecdsa), PGP, X509');
    }
  }
}

/**
 * Read cryptographic key from various sources
 */
function readCryptographicKey(options: RegisterKeyOptions): { content: string, type: KeyType } {
  let keyPath: string;
  
  // Priority: specific key type files > generic path > auto-discovery
  if (options.pgpKeyFile) {
    keyPath = options.pgpKeyFile;
  } else if (options.x509CertFile) {
    keyPath = options.x509CertFile;
  } else if (options.publicKeyFile) {
    keyPath = options.publicKeyFile;
  } else if (options.path) {
    keyPath = options.path;
  } else {
    // Try common SSH key locations for backward compatibility
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
    keyPath = commonPaths.find(path => existsSync(path)) || '';
    if (!keyPath) {
      throw new Error('No key found. Use --path, --pgp-key-file, or --x509-cert-file to specify the key file location');
    }
  }

  if (!existsSync(keyPath)) {
    throw new Error(`Key file not found: ${keyPath}`);
  }

  const keyContent = readFileSync(keyPath, 'utf8').trim();
  if (!keyContent) {
    throw new Error(`Key file is empty: ${keyPath}`);
  }

  // Detect key type
  const keyType = detectKeyType(keyContent);
  
  return { content: keyContent, type: keyType };
}

/**
 * Legacy SSH public key reader for backward compatibility
 */
function readSSHPublicKey(options: RegisterKeyOptions): string {
  const { content } = readCryptographicKey(options);
  return content;
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

/**
 * Read PGP private key for signing
 */
function readPGPPrivateKey(options: RegisterKeyOptions): string {
  let privateKeyPath: string;

  if (options.pgpPrivateKeyFile) {
    privateKeyPath = options.pgpPrivateKeyFile;
  } else {
    // Try common PGP private key locations
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    if (!homeDir) {
      throw new Error('Could not determine home directory');
    }

    const commonPaths = [
      `${homeDir}/.gnupg/secring.gpg`,
      `${homeDir}/.ssh/id_pgp.asc`,
      `${homeDir}/private.asc`
    ];

    // For ASCII armored keys, check for .asc files - filter out directories
    privateKeyPath = commonPaths.find(path => existsSync(path) && !statSync(path).isDirectory()) || '';
    
    if (!privateKeyPath) {
      throw new Error('No PGP private key found for signing. Use --pgp-private-key-file to specify the private key location.');
    }
  }

  if (!existsSync(privateKeyPath)) {
    throw new Error(`PGP private key file not found: ${privateKeyPath}`);
  }

  const privateKeyContent = readFileSync(privateKeyPath, 'utf8').trim();
  if (!privateKeyContent) {
    throw new Error(`PGP private key file is empty: ${privateKeyPath}`);
  }

  if (!privateKeyContent.includes('-----BEGIN PGP PRIVATE KEY BLOCK-----')) {
    throw new Error('Invalid PGP private key format. Expected ASCII armored format.');
  }

  return privateKeyContent;
}

export async function registerKeyCommand(options: RegisterKeyOptions) {
  try {
    console.log(chalk.blue('Registering cryptographic key with blockchain...'));
    
    // Validate .env has all required fields for Git Key operations
    validateGitKeyEnv();
    
    console.log(chalk.gray('Setting up blockchain client...'));
    const { client, config } = await createClientFromEnv();
    
    // Read and detect cryptographic key
    console.log(chalk.gray('Reading cryptographic key...'));
    const { content: keyContent, type: keyType } = readCryptographicKey(options);
    console.log(chalk.gray(`Found ${getKeyTypeName(keyType)} key: ${keyContent.substring(0, 50)}...`));
    console.log(chalk.gray(`Detected key type: ${KeyType[keyType]}`));
    
    // Validate key is suitable for Git signing
    console.log(chalk.gray('Validating key for Git signing...'));
    const validation = await validateKeyForGitSigning(keyType, keyContent);
    if (!validation.valid) {
      throw new Error(`Key validation failed: ${validation.errors.join(', ')}`);
    }
    if (validation.warnings.length > 0) {
      console.log(chalk.yellow('⚠️ Warnings:'));
      validation.warnings.forEach(warning => {
        console.log(chalk.yellow(`  - ${warning}`));
      });
    }
    
    // Format key material for storage
    let keyMaterial: string;
    if (keyType === KeyType.PGPv4) {
      // For PGP keys, extract base64 key material for blockchain registration
      keyMaterial = await extractPGPKeyMaterial(keyContent);
    } else {
      // For other key types, use the existing formatter
      keyMaterial = formatKeyForStorage(keyType, keyContent);
    }
    console.log(chalk.gray(`Key material prepared for storage (${keyMaterial.length} characters)`));
    
    // Generate nonce and signing message
    const nonce = `register_key_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const { createHash } = await import('crypto');
    const nonceHash = createHash('sha256').update(nonce).digest('hex');
    const signingMessage = generateSigningMessage(config.address as `0x${string}`, nonce);
    
    console.log(chalk.gray('Generating signature...'));
    console.log(chalk.gray(`Nonce: ${nonce}`));
    console.log(chalk.gray(`Signing message: ${signingMessage}`));
    
    // Generate signature based on key type
    let signature: string;
    if (keyType === KeyType.SSHEd25519 || keyType === KeyType.SSHSecp256k1) {
      // For SSH keys, use existing SSH signature method
      const privateKeyContent = readSSHPrivateKey(options, options.path);
      signature = generateSSHSignature(privateKeyContent, signingMessage);
    } else if (keyType === KeyType.PGPv4) {
      // For PGP keys, use PGP signature method
      const privateKeyContent = readPGPPrivateKey(options);
      const passphrase = options.pgpPassphrase || process.env.PGP_PASSPHRASE;
      
      console.log(chalk.gray('Generating PGP signature...'));
      try {
        const pgpSignature = await generatePGPSignature(signingMessage, privateKeyContent, passphrase);
        
        // Convert PGP signature to hex format for blockchain storage
        signature = '0x' + Buffer.from(pgpSignature).toString('hex');
      } catch (error) {
        throw new Error(`Failed to generate PGP signature: ${error}`);
      }
    } else {
      // For X509, implementation coming later
      console.log(chalk.yellow('⚠️ X509 signature generation not yet implemented'));
      console.log(chalk.yellow('   Using placeholder signature for testing'));
      signature = '0x' + Buffer.from(`placeholder_sig_${keyType}_${Date.now()}`).toString('hex').padStart(128, '0');
    }
    
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
    
    console.log(chalk.green('✅ Cryptographic key registered successfully!'));
    console.log(chalk.blue('Registration Details:'));
    console.log(chalk.gray(`  Transaction Hash: ${result.hash}`));
    console.log(chalk.gray(`  Key Type: ${getKeyTypeName(keyType)}`));
    console.log(chalk.gray(`  Public Key: ${keyMaterial.substring(0, 32)}...`));
    console.log(chalk.gray(`  Ethereum Address: ${config.address}`));
    console.log(chalk.gray(`  Nonce: ${nonce}`));
    
    // Import key to server for local verification (if not skipped)
    if (!options.skipServerImport) {
      console.log(chalk.blue('\n🔑 Importing key to server for local verification...'));
      
      // For server import, we need the original key format, not the blockchain-stored format
      const keyForServerImport = keyType === KeyType.PGPv4 ? keyContent : gitKeyClaim.publicKey;
      const serverImportResult = await importKeyToServer(gitKeyClaim.keyType, keyForServerImport, config.address as string);
      if (serverImportResult) {
        console.log(chalk.green('✅ Key imported to server successfully'));
      } else {
        console.log(chalk.yellow('⚠️ Key import to server failed (verification may fail without proper key import)'));
      }
    } else {
      console.log(chalk.gray('\n⏭️ Server key import skipped (--skip-server-import flag)'));
    }
    
    console.log(chalk.yellow('\nNext steps:'));
    console.log(chalk.yellow(`  1. Your Git commits signed with this ${getKeyTypeName(keyType)} key are now linked to your Ethereum address`));
    console.log(chalk.yellow('  2. You can now fulfill escrows and prove authorship of commits'));
    console.log(chalk.yellow('  3. Use this same key to sign Git commits for escrow fulfillments'));
    console.log(chalk.yellow('  4. The server can now verify your commit signatures locally'));

  } catch (error) {
    console.error(chalk.red('❌ Failed to register cryptographic key:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    
    // Provide helpful debugging info
    console.log(chalk.yellow('\nTroubleshooting:'));
    console.log(chalk.yellow('  1. For SSH keys: Ensure you have SSH keys generated: ssh-keygen -t ed25519'));
    console.log(chalk.yellow('  2. For PGP keys: Use --pgp-key-file to specify PGP public key file'));
    console.log(chalk.yellow('  3. For X509 certificates: Use --x509-cert-file to specify certificate file'));
    console.log(chalk.yellow('  4. Check that your .env file contains GIT_IDENTITY_REGISTRY_ADDRESS'));
    console.log(chalk.yellow('  5. Verify your private key has sufficient gas for the transaction'));
    console.log(chalk.yellow('  6. Use --skip-server-import if server key import is not needed'));
    
    process.exit(1);
  }
}

/**
 * Import a Git key claim to the server for local verification
 * @param gitKeyClaim - The Git key claim to import
 * @param address - Ethereum address associated with the key
 * @returns Promise<boolean> - Success status
 */
async function importKeyToServer(keyType: KeyType, publicKey: string, address: string): Promise<boolean> {
  try {
    switch (keyType) {
      case KeyType.PGPv4:
        // Check if already imported
        try {
          const openpgp = await import('openpgp');
          const key = await openpgp.readKey({ armoredKey: publicKey });
          const fingerprint = key.getFingerprint();
          const alreadyImported = await isGPGKeyImported(fingerprint);
          
          if (alreadyImported) {
            console.log(chalk.gray('   GPG key already imported to server'));
            return true;
          }
        } catch (error) {
          // Continue with import attempt
        }
        
        return await importGPGKeyToServer(publicKey, address);
        
      case KeyType.SSHEd25519:
      case KeyType.SSHSecp256k1:
        // Check if already imported
        const alreadyImported = await isSSHKeyImported(address);
        if (alreadyImported) {
          console.log(chalk.gray('   SSH key already imported to server'));
          return true;
        }
        
        return await importSSHKeyToServer(publicKey, address);
        
      case KeyType.X509:
        console.log(chalk.yellow('   X509 certificate import not yet implemented'));
        return false;
        
      default:
        console.log(chalk.red(`   Unsupported key type: ${keyType}`));
        return false;
    }
    
  } catch (error) {
    console.error(chalk.red('   Server import error:'), error);
    return false;
  }
}
