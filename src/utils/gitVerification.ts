import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import type { GitKeyClaim } from '../clients/gitIdentityRegistry.js';
import { KeyType } from '../clients/gitIdentityRegistry.js';

const execAsync = promisify(exec);

export interface GitVerificationResult {
  isValid: boolean;
  keyFingerprint?: string;
  signatureType: 'ssh' | 'gpg' | 'x509';
  registeredAddress?: string;
  verificationDetails: {
    gitOutput: string;
    timestamp: number;
    commitHash: string;
    rawGitOutput?: string;
    method: 'git-verify-commit';
  };
  error?: string;
}

export interface GitVerificationConfig {
  tempDirectory?: string;
  timeoutMs?: number;
  enableSSH?: boolean;
  enableGPG?: boolean;
  enableX509?: boolean;
  cleanupAfterVerification?: boolean;
}

export class GitCommitVerifier {
  private config: Required<GitVerificationConfig>;
  
  constructor(config: GitVerificationConfig = {}) {
    this.config = {
      tempDirectory: config.tempDirectory || '/tmp/git-verify',
      timeoutMs: config.timeoutMs || 30000,
      enableSSH: config.enableSSH ?? true,
      enableGPG: config.enableGPG ?? true,
      enableX509: config.enableX509 ?? true,
      cleanupAfterVerification: config.cleanupAfterVerification ?? true,
    };
  }

  /**
   * Verify a commit signature against registered keys using git verify-commit
   * @param repositoryUrl - Git repository URL
   * @param commitHash - Commit hash to verify
   * @param registeredKeys - Map of registered keys by address
   * @returns Verification result
   */
  async verifyCommitSignature(
    repositoryUrl: string,
    commitHash: string,
    registeredKeys: Map<string, GitKeyClaim>
  ): Promise<GitVerificationResult> {
    const workDir = path.join(this.config.tempDirectory, `verify-${randomUUID()}`);
    
    try {
      // Ensure temp directory exists
      await fs.mkdir(this.config.tempDirectory, { recursive: true });
      
      // Clone repository
      console.log(`🔄 Cloning repository: ${repositoryUrl}`);
      await this.cloneRepository(repositoryUrl, workDir);
      
      // Checkout specific commit
      console.log(`🔄 Checking out commit: ${commitHash}`);
      await this.checkoutCommit(workDir, commitHash);
      
      // Configure Git based on registered key types
      await this.configureGitForRegisteredKeys(workDir, registeredKeys);
      
      // Get commit signature information
      console.log(`🔍 Extracting commit signature...`);
      const signatureInfo = await this.getCommitSignature(workDir, commitHash);
      
      if (!signatureInfo.hasSignature) {
        return {
          isValid: false,
          signatureType: 'gpg', // default
          verificationDetails: {
            gitOutput: 'No signature found on commit',
            timestamp: Date.now(),
            commitHash,
            method: 'git-verify-commit',
          },
          error: 'Commit is not signed',
        };
      }
      
      // Try git verify-commit first
      console.log(`🔐 Verifying commit signature with git verify-commit...`);
      const gitVerificationResult = await this.runGitVerifyCommit(workDir, commitHash);
      
      // Parse verification result and match against registered keys
      const result = await this.matchSignatureToRegisteredKey(
        gitVerificationResult,
        signatureInfo,
        registeredKeys,
        commitHash,
        'git-verify-commit'
      );
      
      return result;
      
    } catch (error) {
      console.error('❌ Error during commit verification:', error);
      return {
        isValid: false,
        signatureType: 'gpg', // default
        verificationDetails: {
          gitOutput: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now(),
          commitHash,
          method: 'git-verify-commit',
        },
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      // Cleanup
      if (this.config.cleanupAfterVerification) {
        try {
          await fs.rm(workDir, { recursive: true, force: true });
        } catch (cleanupError) {
          console.warn('⚠️ Failed to cleanup temp directory:', cleanupError);
        }
      }
    }
  }

  /**
   * Clone a Git repository to a temporary directory
   */
  private async cloneRepository(repositoryUrl: string, targetDir: string): Promise<void> {
    const command = `git clone --depth 50 "${repositoryUrl}" "${targetDir}"`;
    
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: this.config.timeoutMs,
      });
      
      if (stderr && !stderr.includes('Cloning into')) {
        console.warn('Git clone warnings:', stderr);
      }
      
      
    } catch (error) {
      throw new Error(`Failed to clone repository: ${error}`);
    }
  }

  /**
   * Configure Git based on registered key types
   */
  private async configureGitForRegisteredKeys(
    workDir: string, 
    registeredKeys: Map<string, GitKeyClaim>
  ): Promise<void> {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '/root';
    
    // Check what types of keys are registered
    const hasSSHKeys = Array.from(registeredKeys.values()).some(
      key => key.keyType === KeyType.SSHEd25519 || key.keyType === KeyType.SSHSecp256k1
    );
    const hasGPGKeys = Array.from(registeredKeys.values()).some(
      key => key.keyType === KeyType.PGPv4
    );
    
    try {
      if (hasSSHKeys) {
        // Configure SSH allowed_signers file
        const allowedSignersFile = path.join(homeDir, '.ssh', 'allowed_signers');
        await execAsync(`git config --local gpg.ssh.allowedSignersFile "${allowedSignersFile}"`, {
          cwd: workDir,
          timeout: 5000,
        });
        console.log(`✅ Git configured for SSH signatures: ${allowedSignersFile}`);
      }
      
      if (hasGPGKeys) {
        // Ensure GPG is configured (it's the default, but be explicit)
        // No need to set gpg.format as 'openpgp' is the default
        console.log(`✅ Git configured for GPG signatures (default)`);
      }
      
    } catch (error) {
      console.warn('⚠️ Failed to configure Git for signature verification:', error);
    }
  }

  /**
   * Checkout a specific commit
   */
  private async checkoutCommit(workDir: string, commitHash: string): Promise<void> {
    try {
      const { stdout, stderr } = await execAsync(`git checkout ${commitHash}`, {
        cwd: workDir,
        timeout: this.config.timeoutMs,
      });
      
      if (stderr && !stderr.includes('HEAD is now at')) {
        console.warn('Git checkout warnings:', stderr);
      }
      
    } catch (error) {
      throw new Error(`Failed to checkout commit ${commitHash}: ${error}`);
    }
  }

  /**
   * Get commit signature information
   */
  private async getCommitSignature(workDir: string, commitHash: string): Promise<{
    hasSignature: boolean;
    signatureType?: 'gpg' | 'ssh' | 'x509';
    keyId?: string;
    fingerprint?: string;
    rawSignature?: string;
  }> {
    try {
      // Get commit information with signature details
      const { stdout } = await execAsync(
        `git show --show-signature --format=fuller ${commitHash}`,
        {
          cwd: workDir,
          timeout: this.config.timeoutMs,
        }
      );
      
      const hasGpgSignature = stdout.includes('gpg:') || stdout.includes('Good signature');
      const hasSshSignature = stdout.includes('Good "git" signature') || stdout.includes('with ED25519 key') || stdout.includes('with RSA key') || stdout.includes('with ECDSA key');
      
      if (hasGpgSignature) {
        // Extract GPG key information
        // Format: gpg: using RSA key DFD1B1D239EF95F7EE2373B39F21AEE1C65BCC33
        const keyIdMatch = stdout.match(/using (?:RSA|DSA|ECDSA|EdDSA) key ([A-F0-9]+)/i);
        
        return {
          hasSignature: true,
          signatureType: 'gpg',
          keyId: keyIdMatch?.[1],
          fingerprint: keyIdMatch?.[1], // For GPG, the key ID is the full fingerprint
          rawSignature: stdout,
        };
      } else if (hasSshSignature) {
        // Extract SSH key information
        // Format: Good "git" signature for user@example.com with ED25519 key SHA256:fingerprint
        const sshKeyMatch = stdout.match(/with ([A-Z0-9]+) key SHA256:([A-Za-z0-9+/=]+)/);
        const emailMatch = stdout.match(/Good "git" signature for ([^\s]+)/);
        
        return {
          hasSignature: true,
          signatureType: 'ssh',
          keyId: sshKeyMatch?.[2], // SHA256 fingerprint
          fingerprint: sshKeyMatch?.[2], // SSH key SHA256 fingerprint
          rawSignature: stdout,
        };
      } else {
        return { hasSignature: false };
      }
      
    } catch (error) {
      console.warn('Failed to get commit signature info:', error);
      return { hasSignature: false };
    }
  }

  /**
   * Verify a commit signature in an already cloned repository
   * @param workDir Path to the cloned repository
   * @param commitHash The commit hash to verify
   * @param registeredKeys Optional map of registered keys (if not provided, will load from contract)
   * @returns Verification result
   */
  async verifyCommitInDirectory(
    workDir: string,
    commitHash: string,
    registeredKeys?: Map<string, GitKeyClaim>
  ): Promise<GitVerificationResult> {
    try {
      console.log(`🔍 Verifying commit ${commitHash} in directory: ${workDir}`);
      
      // Get commit signature info first
      const signatureInfo = await this.getCommitSignature(workDir, commitHash);
      
      if (!signatureInfo.hasSignature) {
        return {
          isValid: false,
          signatureType: 'gpg',
          verificationDetails: {
            gitOutput: 'No signature found',
            timestamp: Date.now(),
            commitHash,
            method: 'git-verify-commit',
          },
          error: 'Commit is not signed',
        };
      }

      // Run git verify-commit to get verification result
      const gitResult = await this.runGitVerifyCommit(workDir, commitHash);
      
      // If registeredKeys not provided, create empty map for now
      if (!registeredKeys) {
        registeredKeys = new Map();
      }

      // Use the existing method to match signature to registered key
      return await this.matchSignatureToRegisteredKey(
        gitResult,
        signatureInfo,
        registeredKeys,
        commitHash,
        'git-verify-commit'
      );

    } catch (error) {
      return {
        isValid: false,
        signatureType: 'gpg',
        verificationDetails: {
          gitOutput: '',
          timestamp: Date.now(),
          commitHash,
          method: 'git-verify-commit',
        },
        error: `Verification error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Run git verify-commit with raw output
   */
  private async runGitVerifyCommit(workDir: string, commitHash: string): Promise<{
    success: boolean;
    rawOutput: string;
    stderr: string;
  }> {
    try {
      const { stdout, stderr } = await execAsync(
        `git verify-commit --raw ${commitHash}`,
        {
          cwd: workDir,
          timeout: this.config.timeoutMs,
        }
      );
      
      return {
        success: true,
        rawOutput: stdout,
        stderr: stderr,
      };
      
    } catch (error: any) {
      // Git verify-commit may exit with non-zero code for invalid signatures
      return {
        success: false,
        rawOutput: error.stdout || '',
        stderr: error.stderr || error.message,
      };
    }
  }

  /**
   * Match signature to registered key
   */
  private async matchSignatureToRegisteredKey(
    gitResult: { success: boolean; rawOutput: string; stderr: string },
    signatureInfo: any,
    registeredKeys: Map<string, GitKeyClaim>,
    commitHash: string,
    method: 'git-verify-commit'
  ): Promise<GitVerificationResult> {
    const timestamp = Date.now();
    
    // Parse Git's raw output for verification details
    const verificationDetails = {
      gitOutput: gitResult.rawOutput + '\n' + gitResult.stderr,
      timestamp,
      commitHash,
      rawGitOutput: gitResult.rawOutput,
      method,
    };
    
    if (!gitResult.success) {
      return {
        isValid: false,
        signatureType: signatureInfo.signatureType || 'gpg',
        verificationDetails,
        error: 'Git signature verification failed',
      };
    }
    
    // Extract key information from Git's raw output
    let keyFingerprint: string | undefined;
    let keyId: string | undefined;
    
    if (signatureInfo.signatureType === 'gpg') {
      // Parse GPG verification output - GPG output goes to stderr
      const gpgOutput = gitResult.rawOutput + '\n' + gitResult.stderr;
      const validSigMatch = gpgOutput.match(/\[GNUPG:\] VALIDSIG ([A-F0-9]+)/i);
      const goodSigMatch = gpgOutput.match(/\[GNUPG:\] GOODSIG ([A-F0-9]+)/i);
      
      keyFingerprint = validSigMatch?.[1] || goodSigMatch?.[1];
      keyId = keyFingerprint;
      
    } else if (signatureInfo.signatureType === 'ssh') {
      // For SSH signatures, use the SHA256 fingerprint from signature info
      keyId = signatureInfo.keyId;
      keyFingerprint = signatureInfo.fingerprint; // SSH SHA256 fingerprint
    }
    
    // Find matching registered key (single key per address)
    let matchedAddress: string | undefined;
    let matchedKeyClaim: GitKeyClaim | undefined;
    
    for (const [address, keyClaim] of registeredKeys.entries()) {
      if (await this.isKeyMatch(keyClaim, keyFingerprint, keyId, signatureInfo.signatureType)) {
        matchedAddress = address;
        matchedKeyClaim = keyClaim;
        break;
      }
    }
    
    if (matchedAddress && matchedKeyClaim) {
      console.log(`✅ Commit signed by registered key for address: ${matchedAddress}`);
      
      return {
        isValid: true,
        keyFingerprint,
        signatureType: signatureInfo.signatureType || 'gpg',
        registeredAddress: matchedAddress,
        verificationDetails,
      };
    } else {
      return {
        isValid: false,
        keyFingerprint,
        signatureType: signatureInfo.signatureType || 'gpg',
        verificationDetails,
        error: 'Registered key does not match the commit signature',
      };
    }
  }

  /**
   * Calculate SHA256 fingerprint for SSH key
   */
  private calculateSSHFingerprint(sshKeyBase64: string): string {
    try {
      // Decode base64 key material
      const keyBuffer = Buffer.from(sshKeyBase64, 'base64');
      // Calculate SHA256 hash and remove base64 padding
      const hash = createHash('sha256').update(keyBuffer).digest('base64').replace(/=+$/, '');
      return hash;
    } catch (error) {
      return '';
    }
  }

  /**
   * Check if a registered key matches the signature
   */
  private async isKeyMatch(
    keyClaim: GitKeyClaim,
    keyFingerprint?: string,
    keyId?: string,
    signatureType?: string
  ): Promise<boolean> {
    if (!keyFingerprint && !keyId) {
      return false;
    }
    
    // Match based on key type
    switch (keyClaim.keyType) {
      case 0: // PGPv4
        if (signatureType !== 'gpg') {
          return false;
        }
        // For GPG keys, extract fingerprint from stored key and compare
        try {
          const openpgp = await import('openpgp');
          
          let key;
          // Handle both armored key format and base64 key material
          if (keyClaim.publicKey.includes('-----BEGIN PGP')) {
            // Full armored key
            key = await openpgp.readKey({ armoredKey: keyClaim.publicKey });
          } else {
            // Base64 key material - try to parse as binary first
            try {
              const keyBytes = Buffer.from(keyClaim.publicKey, 'base64');
              key = await openpgp.readKey({ binaryKey: keyBytes });
            } catch {
              // Fallback: try as armored key with wrapper (legacy format)
              const armoredKey = `-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n${keyClaim.publicKey}\n-----END PGP PUBLIC KEY BLOCK-----`;
              key = await openpgp.readKey({ armoredKey });
            }
          }
          
          const fullFingerprint = key.getFingerprint().toUpperCase();
          
          // Git shows either the full fingerprint or the short key ID (last 16 chars)
          const cleanStoredFingerprint = fullFingerprint.replace(/\s/g, '');
          const cleanCommitFingerprint = keyFingerprint?.replace(/\s/g, '').toUpperCase();
          
          if (!cleanCommitFingerprint) {
            return false;
          }
          
          // Check if it's the full fingerprint match
          if (cleanStoredFingerprint === cleanCommitFingerprint) {
            return true;
          }
          
          // Check if it's the short key ID (last 16 characters of fingerprint)
          const shortKeyId = cleanStoredFingerprint.slice(-16);
          if (shortKeyId === cleanCommitFingerprint) {
            return true;
          }
          
          // Also check key ID from Git output
          if (keyId) {
            const cleanKeyId = keyId.replace(/\s/g, '').toUpperCase();
            if (cleanStoredFingerprint.endsWith(cleanKeyId) || cleanKeyId.endsWith(cleanStoredFingerprint.slice(-16))) {
              return true;
            }
          }
          
          return false;
        } catch (error) {
          console.warn('⚠️ Error parsing PGP key for matching:', error);
          return false;
        }
        
      case 1: // SSHEd25519
      case 2: // SSHSecp256k1
        if (signatureType !== 'ssh') {
          return false;
        }
        
        // For SSH keys, calculate SHA256 fingerprint from registered key and compare
        const registeredKeyMaterial = keyClaim.publicKey.trim();
        const calculatedFingerprint = this.calculateSSHFingerprint(registeredKeyMaterial);
        
        // Compare SHA256 fingerprints
        if (calculatedFingerprint && keyFingerprint && calculatedFingerprint === keyFingerprint) {
          return true;
        }
        
        // Fallback: try direct comparison of base64 key material (for backwards compatibility)
        if (keyId && registeredKeyMaterial === keyId.trim()) {
          return true;
        }
        
        return false;
        
      case 3: // X509
        if (signatureType !== 'x509') return false;
        // For X509, would need certificate fingerprint comparison
        // This is a placeholder for future implementation
        return false;
        
      default:
        return false;
    }
  }

  /**
   * Import a registered key to the server's keychain for verification
   */
  async importKeyToServer(keyClaim: GitKeyClaim, address: string): Promise<boolean> {
    try {
      switch (keyClaim.keyType) {
        case 0: // PGPv4
          return await this.importGPGKey(keyClaim.publicKey, address);
          
        case 1: // SSHEd25519
        case 2: // SSHSecp256k1
          return await this.importSSHKey(keyClaim.publicKey, address);
          
        case 3: // X509
          return await this.importX509Certificate(keyClaim.publicKey, address);
          
        default:
          console.error('❌ Unsupported key type:', keyClaim.keyType);
          return false;
      }
    } catch (error) {
      console.error('❌ Failed to import key for address', address, ':', error);
      return false;
    }
  }

  /**
   * Import GPG key to server keyring
   */
  private async importGPGKey(publicKey: string, address: string): Promise<boolean> {
    try {
      // Write key to temporary file
      const tempKeyFile = path.join(this.config.tempDirectory, `gpg-key-${address}.asc`);
      await fs.mkdir(this.config.tempDirectory, { recursive: true });
      await fs.writeFile(tempKeyFile, publicKey);
      
      // Import to GPG keyring
      const { stdout, stderr } = await execAsync(`gpg --import "${tempKeyFile}"`, {
        timeout: this.config.timeoutMs,
      });
      
      console.log('📝 GPG import result:', stdout);
      if (stderr) console.warn('⚠️ GPG import warnings:', stderr);
      
      // Clean up temp file
      await fs.unlink(tempKeyFile);
      
      return true;
    } catch (error) {
      console.error('❌ GPG key import failed:', error);
      return false;
    }
  }

  /**
   * Import SSH key to server allowed_signers
   */
  private async importSSHKey(publicKey: string, address: string): Promise<boolean> {
    try {
      // For SSH verification, add to allowed signers
      const sshDir = path.join(process.env.HOME || '/tmp', '.ssh');
      await fs.mkdir(sshDir, { recursive: true, mode: 0o700 });
      
      const allowedSignersFile = path.join(sshDir, 'allowed_signers');
      
      // Format: email/identity ssh-ed25519 AAAAC3NzaC1lZDI1NTE5...
      const signerEntry = `${address} ${publicKey.startsWith('ssh-') ? publicKey : `ssh-ed25519 ${publicKey}`}\n`;
      
      // Append to allowed signers file
      await fs.appendFile(allowedSignersFile, signerEntry);
      
      console.log('📝 Added SSH key to allowed signers for address:', address);
      return true;
    } catch (error) {
      console.error('❌ SSH key import failed:', error);
      return false;
    }
  }

  /**
   * Import X509 certificate to server certificate store
   */
  private async importX509Certificate(certificate: string, address: string): Promise<boolean> {
    try {
      // This is a placeholder for X509 certificate import
      // Implementation would depend on the specific certificate store being used
      console.log('⚠️ X509 certificate import not fully implemented for address:', address);
      return false;
    } catch (error) {
      console.error('❌ X509 certificate import failed:', error);
      return false;
    }
  }

  /**
   * Helper method to extract key fingerprint
   */
  private async extractKeyFingerprint(publicKey: string, keyType: KeyType): Promise<string | undefined> {
    try {
      switch (keyType) {
        case 0: // PGPv4
          const openpgp = await import('openpgp');
          const key = await openpgp.readKey({ armoredKey: publicKey });
          return key.getFingerprint().toUpperCase();
          
        case 1: // SSHEd25519
        case 2: // SSHSecp256k1
          // For SSH keys, use the key material as fingerprint
          return publicKey.trim();
          
        case 3: // X509
          // For X509, would extract certificate fingerprint
          return undefined; // Placeholder
          
        default:
          return undefined;
      }
    } catch (error) {
      console.error('Failed to extract key fingerprint:', error);
      return undefined;
    }
  }

  /**
   * Helper method to get signature type from key type
   */
  private getSignatureTypeFromKeyType(keyType: KeyType): 'ssh' | 'gpg' | 'x509' {
    switch (keyType) {
      case 0: return 'gpg';
      case 1:
      case 2: return 'ssh';
      case 3: return 'x509';
      default: return 'gpg';
    }
  }
}

/**
 * Utility function to create a Git commit verifier with default config
 */
export function createGitCommitVerifier(config?: GitVerificationConfig): GitCommitVerifier {
  return new GitCommitVerifier(config);
}

/**
 * Helper function to extract key fingerprint from different key types
 */
export async function extractKeyFingerprint(publicKey: string, keyType: KeyType): Promise<string | null> {
  try {
    switch (keyType) {
      case 0: // PGPv4
        const openpgp = await import('openpgp');
        const key = await openpgp.readKey({ armoredKey: publicKey });
        return key.getFingerprint().toUpperCase();
        
      case 1: // SSHEd25519
      case 2: // SSHSecp256k1
        // For SSH keys, use the key material as fingerprint
        return publicKey.trim();
        
      case 3: // X509
        // For X509, would extract certificate fingerprint
        return null; // Placeholder
        
      default:
        return null;
    }
  } catch (error) {
    console.error('Failed to extract key fingerprint:', error);
    return null;
  }
}