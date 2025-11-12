import chalk from 'chalk';
import { createHash } from 'crypto';
import type { GitKeyClaim } from '../clients/gitIdentityRegistry.js';
import { GitCommitVerifier, type GitVerificationResult, type GitVerificationConfig } from '../utils/gitVerification.js';
import { 
  importSSHKeyToServer, 
  importGPGKeyToServer, 
  isSSHKeyImported, 
  isGPGKeyImported,
  initializeServerGitEnvironment,
  getServerGitCapabilities 
} from '../utils/keyUtils.js';

export interface VerificationServiceConfig extends GitVerificationConfig {
  autoImportKeys?: boolean;
  enableCaching?: boolean;
  cacheExpiryMs?: number;
}

export interface CachedVerificationResult {
  result: GitVerificationResult;
  timestamp: number;
  expiresAt: number;
}

export class GitVerificationService {
  private verifier: GitCommitVerifier;
  private config: Required<VerificationServiceConfig>;
  private verificationCache: Map<string, CachedVerificationResult> = new Map();
  private keyImportCache: Map<string, boolean> = new Map();
  private initialized: boolean = false;

  constructor(config: VerificationServiceConfig = {}) {
    this.config = {
      tempDirectory: config.tempDirectory || '/tmp/git-verify',
      timeoutMs: config.timeoutMs || 30000,
      enableSSH: config.enableSSH ?? true,
      enableGPG: config.enableGPG ?? true,
      enableX509: config.enableX509 ?? true,
      cleanupAfterVerification: config.cleanupAfterVerification ?? true,
      autoImportKeys: config.autoImportKeys ?? true,
      enableCaching: config.enableCaching ?? true,
      cacheExpiryMs: config.cacheExpiryMs || 3600000, // 1 hour
    };

    this.verifier = new GitCommitVerifier(this.config);
  }

  /**
   * Initialize the verification service
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) {
      return true;
    }

    console.log(chalk.blue('Initializing Git Verification Service...'));

    try {
      // Initialize server Git environment
      const envInitialized = await initializeServerGitEnvironment();
      if (!envInitialized) {
        console.warn(chalk.yellow('⚠️ Failed to fully initialize Git environment'));
      }

      // Check server capabilities
      const capabilities = await getServerGitCapabilities();
      console.log(chalk.gray('Server capabilities:'));
      console.log(chalk.gray(`  Git: ${capabilities.git ? 'OK' : 'NOT AVAILABLE'}`));
      console.log(chalk.gray(`  GPG: ${capabilities.gpg ? 'OK' : 'NOT AVAILABLE'}`));
      console.log(chalk.gray(`  SSH: ${capabilities.ssh ? 'OK' : 'NOT AVAILABLE'}`));

      if (!capabilities.git) {
        throw new Error('Git is required but not available on the server');
      }

      // Update config based on capabilities
      if (!capabilities.gpg) {
        this.config.enableGPG = false;
        console.warn(chalk.yellow('⚠️ GPG verification disabled (GPG not available)'));
      }

      if (!capabilities.ssh) {
        console.warn(chalk.yellow('⚠️ SSH verification may be limited (SSH tools not available)'));
      }

      this.initialized = true;
      console.log(chalk.green('Git Verification Service initialized'));
      return true;

    } catch (error) {
      console.error(chalk.red('❌ Failed to initialize Git Verification Service:'), error);
      return false;
    }
  }

  /**
   * Verify a commit signature with automatic key import
   * @param repositoryUrl - Git repository URL
   * @param commitHash - Commit hash to verify
   * @param registeredKeys - Map of registered keys by address
   * @returns Verification result
   */
  async verifyCommit(
    repositoryUrl: string,
    commitHash: string,
    registeredKeys: Map<string, GitKeyClaim>
  ): Promise<GitVerificationResult> {
    if (!this.initialized) {
      const initialized = await this.initialize();
      if (!initialized) {
        return {
          isValid: false,
          signatureType: 'gpg',
          verificationDetails: {
            gitOutput: 'Verification service not initialized',
            timestamp: Date.now(),
            commitHash,
            method: 'git-verify-commit',
          },
          error: 'Verification service initialization failed',
        };
      }
    }

    // Check cache first
    if (this.config.enableCaching) {
      // Include a hash of registered keys to invalidate cache when keys change
      const keysHash = this.hashRegisteredKeys(registeredKeys);
      const cacheKey = `${repositoryUrl}:${commitHash}:${keysHash}`;
      const cachedResult = this.getCachedResult(cacheKey);
      if (cachedResult) {
        console.log(chalk.gray('📋 Using cached verification result'));
        return cachedResult;
      }
    }

    // Import keys if needed
    if (this.config.autoImportKeys) {
      await this.importRegisteredKeys(registeredKeys);
    }

    console.log(chalk.blue(`🔍 Verifying commit ${commitHash.substring(0, 8)}... from ${repositoryUrl}`));

    try {
      // Perform verification
      const result = await this.verifier.verifyCommitSignature(
        repositoryUrl,
        commitHash,
        registeredKeys
      );

      // Cache the result
      if (this.config.enableCaching) {
        const keysHash = this.hashRegisteredKeys(registeredKeys);
        const cacheKey = `${repositoryUrl}:${commitHash}:${keysHash}`;
        this.cacheResult(cacheKey, result);
      }

      // Log result
      if (result.isValid) {
        console.log(chalk.green(`✅ Commit signature verified`));
        console.log(chalk.gray(`   Signed by: ${result.registeredAddress}`));
        console.log(chalk.gray(`   Method: ${result.verificationDetails.method}`));
      } else {
        console.log(chalk.red(`❌ Commit signature verification failed`));
        console.log(chalk.gray(`   Error: ${result.error}`));
        console.log(chalk.gray(`   Method: ${result.verificationDetails.method}`));
      }

      return result;

    } catch (error) {
      console.error(chalk.red('❌ Verification service error:'), error);
      return {
        isValid: false,
        signatureType: 'gpg',
        verificationDetails: {
          gitOutput: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now(),
          commitHash,
          method: 'git-verify-commit',
        },
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Import all registered keys to the server
   * @param registeredKeys - Map of registered keys by address (single key per address)
   */
  async importRegisteredKeys(registeredKeys: Map<string, GitKeyClaim>): Promise<void> {
    console.log(chalk.blue(`🔑 Importing key for sender address...`));

    let imported = 0;
    let skipped = 0;
    let failed = 0;

    for (const [address, keyClaim] of registeredKeys.entries()) {
      const importResult = await this.importSingleKey(address, keyClaim);
      
      if (importResult === 'imported') {
        imported++;
      } else if (importResult === 'skipped') {
        skipped++;
      } else {
        failed++;
      }
    }

    if (imported > 0) {
      console.log(chalk.gray(`✓ Key imported successfully`));
    } else if (skipped > 0) {
      console.log(chalk.gray(`✓ Key already imported`));
    } else {
      console.log(chalk.yellow(`⚠️ Key import failed`));
    }
  }

  /**
   * Import a single key to the server
   * @param address - Ethereum address
   * @param keyClaim - Git key claim
   * @returns Import result status
   */
  async importSingleKey(address: string, keyClaim: GitKeyClaim): Promise<'imported' | 'skipped' | 'failed'> {
    try {
      console.log(chalk.gray(`   Processing key import for address: ${address}`));
      console.log(chalk.gray(`      Key type: ${keyClaim.keyType}, Public key: ${keyClaim.publicKey.substring(0, 30)}...`));
      
      // Check cache with public key hash to detect key changes
      // Use a hash of the public key to ensure we re-import when the key changes
      const keyHash = createHash('sha256').update(keyClaim.publicKey).digest('hex').substring(0, 16);
      const cacheKey = `import:${address}:${keyClaim.keyType}:${keyHash}`;
      
      if (this.keyImportCache.has(cacheKey)) {
        console.log(chalk.gray(`      ⏭️  Skipped (in cache)`));
        return 'skipped';
      }
      
      // Clear old cache entries for this address/keyType (different key)
      // This handles the case where user registers a new key of the same type
      for (const cachedKey of this.keyImportCache.keys()) {
        if (cachedKey.startsWith(`import:${address}:${keyClaim.keyType}:`)) {
          this.keyImportCache.delete(cachedKey);
        }
      }

      let alreadyImported = false;
      let importSuccess = false;

      switch (keyClaim.keyType) {
        case 0: // PGPv4
          if (!this.config.enableGPG) {
            return 'skipped';
          }
          
          // Check if already imported (using key fingerprint if possible)
          try {
            const openpgp = await import('openpgp');
            let key;
            
            // Handle both armored key format and base64 key material
            if (keyClaim.publicKey.includes('-----BEGIN PGP')) {
              // Full armored key
              key = await openpgp.readKey({ armoredKey: keyClaim.publicKey });
            } else {
              // Base64 key material - reconstruct armored format first
              try {
                const keyBytes = Buffer.from(keyClaim.publicKey, 'base64');
                key = await openpgp.readKey({ binaryKey: keyBytes });
              } catch {
                // Fallback: try as armored key with wrapper
                const armoredKey = `-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n${keyClaim.publicKey}\n-----END PGP PUBLIC KEY BLOCK-----`;
                key = await openpgp.readKey({ armoredKey });
              }
            }
            
            const fingerprint = key.getFingerprint();
            alreadyImported = await isGPGKeyImported(fingerprint);
          } catch {
            alreadyImported = await isGPGKeyImported(address);
          }

          if (alreadyImported) {
            this.keyImportCache.set(cacheKey, true);
            return 'skipped';
          }

          // For import, we need the full armored key
          let keyForImport = keyClaim.publicKey;
          if (!keyClaim.publicKey.includes('-----BEGIN PGP')) {
            try {
              const openpgp = await import('openpgp');
              const keyBytes = Buffer.from(keyClaim.publicKey, 'base64');
              const key = await openpgp.readKey({ binaryKey: keyBytes });
              keyForImport = key.armor();
            } catch {
              console.warn(chalk.yellow(`⚠️ Failed to convert PGP key material to armored format for ${address}`));
              return 'failed';
            }
          }

          importSuccess = await importGPGKeyToServer(keyForImport, address);
          break;

        case 1: // SSHEd25519
        case 2: // SSHSecp256k1
          console.log(`   Checking SSH key for ${address}...`);
          
          if (!this.config.enableSSH) {
            console.log(`   ⏭️  SSH import disabled in config`);
            return 'skipped';
          }

          alreadyImported = await isSSHKeyImported(address);
          if (alreadyImported) {
            console.log(`   ℹ️  SSH key already imported for ${address}`);
            this.keyImportCache.set(cacheKey, true);
            return 'skipped';
          }

          console.log(`   ⬇️  Importing SSH key for ${address}...`);
          importSuccess = await importSSHKeyToServer(keyClaim.publicKey, address);
          break;

        case 3: // X509
          if (!this.config.enableX509) {
            return 'skipped';
          }
          
          // X509 import not fully implemented
          console.warn(chalk.yellow(`⚠️ X509 key import not implemented for ${address}`));
          return 'skipped';

        default:
          console.warn(chalk.yellow(`⚠️ Unsupported key type ${keyClaim.keyType} for ${address}`));
          return 'failed';
      }

      if (importSuccess) {
        this.keyImportCache.set(cacheKey, true);
        return 'imported';
      } else {
        return 'failed';
      }

    } catch (error) {
      console.error(chalk.red(`❌ Failed to import key for ${address}:`), error);
      return 'failed';
    }
  }

  /**
   * Get cached verification result
   */
  private getCachedResult(cacheKey: string): GitVerificationResult | null {
    const cached = this.verificationCache.get(cacheKey);
    if (!cached) {
      return null;
    }

    if (Date.now() > cached.expiresAt) {
      this.verificationCache.delete(cacheKey);
      return null;
    }

    return cached.result;
  }

  /**
   * Cache verification result
   */
  private cacheResult(cacheKey: string, result: GitVerificationResult): void {
    const cached: CachedVerificationResult = {
      result,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.config.cacheExpiryMs,
    };

    this.verificationCache.set(cacheKey, cached);

    // Clean up expired entries (simple cleanup)
    if (this.verificationCache.size > 1000) {
      this.cleanupCache();
    }
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, cached] of this.verificationCache.entries()) {
      if (now > cached.expiresAt) {
        this.verificationCache.delete(key);
      }
    }
  }

  /**
   * Generate a hash of registered keys for cache invalidation
   */
  private hashRegisteredKeys(registeredKeys: Map<string, GitKeyClaim>): string {
    const keyData = Array.from(registeredKeys.entries())
      .sort(([a], [b]) => a.localeCompare(b)) // Sort for consistent hash
      .map(([address, claim]) => `${address}:${claim.keyType}:${claim.publicKey}`)
      .join('|');
    return createHash('sha256').update(keyData).digest('hex').substring(0, 8);
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      initialized: this.initialized,
      cacheSize: this.verificationCache.size,
      keyImportCacheSize: this.keyImportCache.size,
      config: {
        enableSSH: this.config.enableSSH,
        enableGPG: this.config.enableGPG,
        enableX509: this.config.enableX509,
        autoImportKeys: this.config.autoImportKeys,
        enableCaching: this.config.enableCaching,
      },
    };
  }

  /**
   * Test the verification service with a known repository/commit
   */
  async testVerification(testRepo?: string, testCommit?: string): Promise<boolean> {
    try {
      console.log(chalk.blue('🧪 Testing Git verification service...'));

      // Use a known public repository for testing
      const repoUrl = testRepo || 'https://github.com/CoopHive/git-commit-trading.git';
      const commitHash = testCommit || 'HEAD';

      // Create empty registered keys map for test
      const testKeys = new Map<string, GitKeyClaim>();

      const result = await this.verifyCommit(repoUrl, commitHash, testKeys);

      console.log(chalk.gray('Test verification result:'));
      console.log(chalk.gray(`  Valid: ${result.isValid}`));
      console.log(chalk.gray(`  Method: ${result.verificationDetails.method}`));
      console.log(chalk.gray(`  Error: ${result.error || 'None'}`));

      return true; // Test completed successfully (result may be invalid, but service worked)

    } catch (error) {
      console.error(chalk.red('❌ Verification service test failed:'), error);
      return false;
    }
  }
}

/**
 * Create a Git verification service with default configuration
 */
export function createGitVerificationService(config?: VerificationServiceConfig): GitVerificationService {
  return new GitVerificationService(config);
}

/**
 * Singleton instance for the default verification service
 */
let defaultService: GitVerificationService | null = null;

/**
 * Get the default Git verification service instance
 */
export function getGitVerificationService(config?: VerificationServiceConfig): GitVerificationService {
  if (!defaultService || config) {
    defaultService = new GitVerificationService(config);
  }
  return defaultService;
}