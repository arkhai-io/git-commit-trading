import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { GitKeyClaim, KeyType } from '../clients/gitIdentityRegistry.js';

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
      const hasSshSignature = stdout.includes('Good "git" signature') || stdout.includes('ssh-');
      
      if (hasGpgSignature) {
        // Extract GPG key information
        const keyIdMatch = stdout.match(/using (?:RSA|DSA|ECDSA|EdDSA) key ([A-F0-9]+)/i);
        const fingerprintMatch = stdout.match(/Primary key fingerprint: ([A-F0-9 ]+)/i);
        
        return {
          hasSignature: true,
          signatureType: 'gpg',
          keyId: keyIdMatch?.[1],
          fingerprint: fingerprintMatch?.[1]?.replace(/\s/g, ''),
          rawSignature: stdout,
        };
      } else if (hasSshSignature) {
        // Extract SSH key information
        const sshKeyMatch = stdout.match(/ssh-([a-zA-Z0-9]+) ([A-Za-z0-9+/=]+)/);
        
        return {
          hasSignature: true,
          signatureType: 'ssh',
          keyId: sshKeyMatch?.[2], // SSH key material
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
      // Parse GPG verification output
      const validSigMatch = gitResult.rawOutput.match(/\\[GNUPG:\\] VALIDSIG ([A-F0-9]+)/i);
      const goodSigMatch = gitResult.rawOutput.match(/\\[GNUPG:\\] GOODSIG ([A-F0-9]+)/i);
      
      keyFingerprint = validSigMatch?.[1] || goodSigMatch?.[1];
      keyId = keyFingerprint;
      
    } else if (signatureInfo.signatureType === 'ssh') {
      // For SSH signatures, use the key material from signature info
      keyId = signatureInfo.keyId;
      keyFingerprint = keyId; // For SSH, key material serves as identifier
    }
    
    // Find matching registered key
    let matchedAddress: string | undefined;
    for (const [address, keyClaim] of registeredKeys.entries()) {
      if (await this.isKeyMatch(keyClaim, keyFingerprint, keyId, signatureInfo.signatureType)) {
        matchedAddress = address;
        break;
      }
    }
    
    if (matchedAddress) {
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
        error: 'No registered key matches the commit signature',
      };
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
        if (signatureType !== 'gpg') return false;
        // For GPG keys, try to extract fingerprint from stored key
        try {
          const openpgp = await import('openpgp');
          const key = await openpgp.readKey({ armoredKey: keyClaim.publicKey });
          const fingerprint = key.getFingerprint().toUpperCase();
          return fingerprint === keyFingerprint?.toUpperCase();
        } catch {
          return false;
        }
        
      case 1: // SSHEd25519
      case 2: // SSHSecp256k1
        if (signatureType !== 'ssh') return false;
        // For SSH keys, compare the key material
        const keyMaterial = keyClaim.publicKey.trim();
        return keyMaterial === keyId?.trim();
        
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