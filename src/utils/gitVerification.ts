import { exec } from 'child_process';
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

const DEFAULT_CONFIG: Required<GitVerificationConfig> = {
  tempDirectory: '/tmp/git-verify',
  timeoutMs: 30000,
  enableSSH: true,
  enableGPG: true,
  enableX509: true,
  cleanupAfterVerification: true,
};

function resolveConfig(config?: GitVerificationConfig): Required<GitVerificationConfig> {
  return { ...DEFAULT_CONFIG, ...config };
}

/**
 * Verify a commit signature against registered keys using git verify-commit.
 * This clones the repository to a temp directory, verifies, then cleans up.
 *
 * @param repositoryUrl - Git repository URL
 * @param commitHash - Commit hash to verify
 * @param registeredKeys - Map of registered keys by address
 * @param config - Optional verification config
 * @returns Verification result
 */
export async function verifyCommitSignature(
  repositoryUrl: string,
  commitHash: string,
  registeredKeys: Map<string, GitKeyClaim>,
  config?: GitVerificationConfig
): Promise<GitVerificationResult> {
  const cfg = resolveConfig(config);
  const workDir = path.join(cfg.tempDirectory, `verify-${randomUUID()}`);

  try {
    await fs.mkdir(cfg.tempDirectory, { recursive: true });

    console.log(`🔄 Cloning repository: ${repositoryUrl}`);
    await cloneRepository(repositoryUrl, workDir, cfg.timeoutMs);

    console.log(`🔄 Checking out commit: ${commitHash}`);
    await checkoutCommit(workDir, commitHash, cfg.timeoutMs);

    await configureGitForRegisteredKeys(workDir, registeredKeys);

    console.log(`🔍 Extracting commit signature...`);
    const signatureInfo = await getCommitSignature(workDir, commitHash, cfg.timeoutMs);

    if (!signatureInfo.hasSignature) {
      return {
        isValid: false,
        signatureType: 'gpg',
        verificationDetails: {
          gitOutput: 'No signature found on commit',
          timestamp: Date.now(),
          commitHash,
          method: 'git-verify-commit',
        },
        error: 'Commit is not signed',
      };
    }

    console.log(`🔐 Verifying commit signature with git verify-commit...`);
    const gitVerificationResult = await runGitVerifyCommit(workDir, commitHash, cfg.timeoutMs);

    return await matchSignatureToRegisteredKey(
      gitVerificationResult,
      signatureInfo,
      registeredKeys,
      commitHash
    );
  } catch (error) {
    console.error('❌ Error during commit verification:', error);
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
  } finally {
    if (cfg.cleanupAfterVerification) {
      try {
        await fs.rm(workDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn('⚠️ Failed to cleanup temp directory:', cleanupError);
      }
    }
  }
}

/**
 * Verify a commit signature in an already cloned repository.
 *
 * @param workDir - Path to the cloned repository
 * @param commitHash - The commit hash to verify
 * @param registeredKeys - Map of registered keys by address
 * @param config - Optional verification config
 * @returns Verification result
 */
export async function verifyCommitInDirectory(
  workDir: string,
  commitHash: string,
  registeredKeys: Map<string, GitKeyClaim>,
  config?: GitVerificationConfig
): Promise<GitVerificationResult> {
  const cfg = resolveConfig(config);

  try {
    console.log(`🔍 Verifying commit ${commitHash} in directory: ${workDir}`);

    await configureGitForRegisteredKeys(workDir, registeredKeys);

    const signatureInfo = await getCommitSignature(workDir, commitHash, cfg.timeoutMs);

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

    const gitResult = await runGitVerifyCommit(workDir, commitHash, cfg.timeoutMs);

    return await matchSignatureToRegisteredKey(
      gitResult,
      signatureInfo,
      registeredKeys,
      commitHash
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
 * Import a registered key to the server's keychain for verification.
 *
 * @param keyClaim - The key claim to import
 * @param address - The address associated with the key
 * @param config - Optional verification config
 * @returns Whether import succeeded
 */
export async function importKeyToServer(
  keyClaim: GitKeyClaim,
  address: string,
  config?: GitVerificationConfig
): Promise<boolean> {
  const cfg = resolveConfig(config);

  try {
    switch (keyClaim.keyType) {
      case KeyType.PGPv4:
        return await importGPGKey(keyClaim.publicKey, address, cfg);

      case KeyType.SSHEd25519:
      case KeyType.SSHSecp256k1:
        return await importSSHKey(keyClaim.publicKey, address);

      case KeyType.X509:
        return await importX509Certificate(keyClaim.publicKey, address);

      default:
        console.error('❌ Unsupported key type:', keyClaim.keyType);
        return false;
    }
  } catch (error) {
    console.error('❌ Failed to import key for address', address, ':', error);
    return false;
  }
}

// ============================================================================
// Internal helper functions
// ============================================================================

async function cloneRepository(
  repositoryUrl: string,
  targetDir: string,
  timeoutMs: number
): Promise<void> {
  const command = `git clone --depth 50 "${repositoryUrl}" "${targetDir}"`;

  try {
    const { stderr } = await execAsync(command, { timeout: timeoutMs });
    if (stderr && !stderr.includes('Cloning into')) {
      console.warn('Git clone warnings:', stderr);
    }
  } catch (error) {
    throw new Error(`Failed to clone repository: ${error}`);
  }
}

async function checkoutCommit(
  workDir: string,
  commitHash: string,
  timeoutMs: number
): Promise<void> {
  try {
    const { stderr } = await execAsync(`git checkout ${commitHash}`, {
      cwd: workDir,
      timeout: timeoutMs,
    });
    if (stderr && !stderr.includes('HEAD is now at')) {
      console.warn('Git checkout warnings:', stderr);
    }
  } catch (error) {
    throw new Error(`Failed to checkout commit ${commitHash}: ${error}`);
  }
}

async function configureGitForRegisteredKeys(
  workDir: string,
  registeredKeys: Map<string, GitKeyClaim>
): Promise<void> {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '/root';

  const hasSSHKeys = Array.from(registeredKeys.values()).some(
    key => key.keyType === KeyType.SSHEd25519 || key.keyType === KeyType.SSHSecp256k1
  );
  const hasGPGKeys = Array.from(registeredKeys.values()).some(
    key => key.keyType === KeyType.PGPv4
  );

  try {
    if (hasSSHKeys) {
      const allowedSignersFile = path.join(homeDir, '.ssh', 'allowed_signers');
      await execAsync(`git config --local gpg.ssh.allowedSignersFile "${allowedSignersFile}"`, {
        cwd: workDir,
        timeout: 5000,
      });
      console.log(`✅ Git configured for SSH signatures: ${allowedSignersFile}`);
    }

    if (hasGPGKeys) {
      console.log(`✅ Git configured for GPG signatures (default)`);
    }
  } catch (error) {
    console.warn('⚠️ Failed to configure Git for signature verification:', error);
  }
}

interface SignatureInfo {
  hasSignature: boolean;
  signatureType?: 'gpg' | 'ssh' | 'x509';
  keyId?: string;
  fingerprint?: string;
  rawSignature?: string;
}

async function getCommitSignature(
  workDir: string,
  commitHash: string,
  timeoutMs: number
): Promise<SignatureInfo> {
  try {
    const { stdout } = await execAsync(
      `git show --show-signature --format=fuller ${commitHash}`,
      { cwd: workDir, timeout: timeoutMs }
    );

    const hasGpgSignature = stdout.includes('gpg:') || stdout.includes('Good signature');
    const hasSshSignature =
      stdout.includes('Good "git" signature') ||
      stdout.includes('with ED25519 key') ||
      stdout.includes('with RSA key') ||
      stdout.includes('with ECDSA key');

    if (hasGpgSignature) {
      const keyIdMatch = stdout.match(/using (?:RSA|DSA|ECDSA|EdDSA) key ([A-F0-9]+)/i);
      return {
        hasSignature: true,
        signatureType: 'gpg',
        keyId: keyIdMatch?.[1],
        fingerprint: keyIdMatch?.[1],
        rawSignature: stdout,
      };
    } else if (hasSshSignature) {
      const sshKeyMatch = stdout.match(/with ([A-Z0-9]+) key SHA256:([A-Za-z0-9+/=]+)/);
      return {
        hasSignature: true,
        signatureType: 'ssh',
        keyId: sshKeyMatch?.[2],
        fingerprint: sshKeyMatch?.[2],
        rawSignature: stdout,
      };
    }

    return { hasSignature: false };
  } catch (error) {
    console.warn('Failed to get commit signature info:', error);
    return { hasSignature: false };
  }
}

async function runGitVerifyCommit(
  workDir: string,
  commitHash: string,
  timeoutMs: number
): Promise<{ success: boolean; rawOutput: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execAsync(`git verify-commit --raw ${commitHash}`, {
      cwd: workDir,
      timeout: timeoutMs,
    });
    return { success: true, rawOutput: stdout, stderr };
  } catch (error: any) {
    return {
      success: false,
      rawOutput: error.stdout || '',
      stderr: error.stderr || error.message,
    };
  }
}

async function matchSignatureToRegisteredKey(
  gitResult: { success: boolean; rawOutput: string; stderr: string },
  signatureInfo: SignatureInfo,
  registeredKeys: Map<string, GitKeyClaim>,
  commitHash: string
): Promise<GitVerificationResult> {
  const timestamp = Date.now();

  const verificationDetails = {
    gitOutput: gitResult.rawOutput + '\n' + gitResult.stderr,
    timestamp,
    commitHash,
    rawGitOutput: gitResult.rawOutput,
    method: 'git-verify-commit' as const,
  };

  if (!gitResult.success) {
    return {
      isValid: false,
      signatureType: signatureInfo.signatureType || 'gpg',
      verificationDetails,
      error: 'Git signature verification failed',
    };
  }

  let keyFingerprint: string | undefined;
  let keyId: string | undefined;

  if (signatureInfo.signatureType === 'gpg') {
    const gpgOutput = gitResult.rawOutput + '\n' + gitResult.stderr;
    const validSigMatch = gpgOutput.match(/\[GNUPG:\] VALIDSIG ([A-F0-9]+)/i);
    const goodSigMatch = gpgOutput.match(/\[GNUPG:\] GOODSIG ([A-F0-9]+)/i);
    keyFingerprint = validSigMatch?.[1] || goodSigMatch?.[1];
    keyId = keyFingerprint;
  } else if (signatureInfo.signatureType === 'ssh') {
    keyId = signatureInfo.keyId;
    keyFingerprint = signatureInfo.fingerprint;
  }

  let matchedAddress: string | undefined;

  for (const [address, keyClaim] of registeredKeys.entries()) {
    if (await isKeyMatch(keyClaim, keyFingerprint, keyId, signatureInfo.signatureType)) {
      matchedAddress = address;
      break;
    }
  }

  if (matchedAddress) {
    console.log(`✅ Commit signed by registered key for address: ${matchedAddress}`);
    return {
      isValid: true,
      keyFingerprint,
      signatureType: signatureInfo.signatureType || 'gpg',
      registeredAddress: matchedAddress,
      verificationDetails,
    };
  }

  return {
    isValid: false,
    keyFingerprint,
    signatureType: signatureInfo.signatureType || 'gpg',
    verificationDetails,
    error: 'Registered key does not match the commit signature',
  };
}

function calculateSSHFingerprint(sshKeyBase64: string): string {
  try {
    const keyBuffer = Buffer.from(sshKeyBase64, 'base64');
    const hash = createHash('sha256').update(keyBuffer).digest('base64').replace(/=+$/, '');
    return hash;
  } catch {
    return '';
  }
}

async function isKeyMatch(
  keyClaim: GitKeyClaim,
  keyFingerprint?: string,
  keyId?: string,
  signatureType?: string
): Promise<boolean> {
  if (!keyFingerprint && !keyId) {
    return false;
  }

  switch (keyClaim.keyType) {
    case KeyType.PGPv4:
      if (signatureType !== 'gpg') return false;

      try {
        const openpgp = await import('openpgp');

        let key;
        if (keyClaim.publicKey.includes('-----BEGIN PGP')) {
          key = await openpgp.readKey({ armoredKey: keyClaim.publicKey });
        } else {
          try {
            const keyBytes = Buffer.from(keyClaim.publicKey, 'base64');
            key = await openpgp.readKey({ binaryKey: keyBytes });
          } catch {
            const armoredKey = `-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n${keyClaim.publicKey}\n-----END PGP PUBLIC KEY BLOCK-----`;
            key = await openpgp.readKey({ armoredKey });
          }
        }

        const fullFingerprint = key.getFingerprint().toUpperCase();
        const cleanStoredFingerprint = fullFingerprint.replace(/\s/g, '');
        const cleanCommitFingerprint = keyFingerprint?.replace(/\s/g, '').toUpperCase();

        if (!cleanCommitFingerprint) return false;

        if (cleanStoredFingerprint === cleanCommitFingerprint) return true;

        const shortKeyId = cleanStoredFingerprint.slice(-16);
        if (shortKeyId === cleanCommitFingerprint) return true;

        if (keyId) {
          const cleanKeyId = keyId.replace(/\s/g, '').toUpperCase();
          if (
            cleanStoredFingerprint.endsWith(cleanKeyId) ||
            cleanKeyId.endsWith(cleanStoredFingerprint.slice(-16))
          ) {
            return true;
          }
        }

        return false;
      } catch (error) {
        console.warn('⚠️ Error parsing PGP key for matching:', error);
        return false;
      }

    case KeyType.SSHEd25519:
    case KeyType.SSHSecp256k1:
      if (signatureType !== 'ssh') return false;

      const registeredKeyMaterial = keyClaim.publicKey.trim();
      const calculatedFingerprint = calculateSSHFingerprint(registeredKeyMaterial);

      if (calculatedFingerprint && keyFingerprint && calculatedFingerprint === keyFingerprint) {
        return true;
      }

      if (keyId && registeredKeyMaterial === keyId.trim()) {
        return true;
      }

      return false;

    case KeyType.X509:
      if (signatureType !== 'x509') return false;
      // Placeholder for future implementation
      return false;

    default:
      return false;
  }
}

async function importGPGKey(
  publicKey: string,
  address: string,
  cfg: Required<GitVerificationConfig>
): Promise<boolean> {
  try {
    const tempKeyFile = path.join(cfg.tempDirectory, `gpg-key-${address}.asc`);
    await fs.mkdir(cfg.tempDirectory, { recursive: true });
    await fs.writeFile(tempKeyFile, publicKey);

    const { stdout, stderr } = await execAsync(`gpg --import "${tempKeyFile}"`, {
      timeout: cfg.timeoutMs,
    });

    console.log('📝 GPG import result:', stdout);
    if (stderr) console.warn('⚠️ GPG import warnings:', stderr);

    await fs.unlink(tempKeyFile);
    return true;
  } catch (error) {
    console.error('❌ GPG key import failed:', error);
    return false;
  }
}

async function importSSHKey(publicKey: string, address: string): Promise<boolean> {
  try {
    const sshDir = path.join(process.env.HOME || '/tmp', '.ssh');
    await fs.mkdir(sshDir, { recursive: true, mode: 0o700 });

    const allowedSignersFile = path.join(sshDir, 'allowed_signers');
    const signerEntry = `${address} ${publicKey.startsWith('ssh-') ? publicKey : `ssh-ed25519 ${publicKey}`}\n`;

    await fs.appendFile(allowedSignersFile, signerEntry);

    console.log('📝 Added SSH key to allowed signers for address:', address);
    return true;
  } catch (error) {
    console.error('❌ SSH key import failed:', error);
    return false;
  }
}

async function importX509Certificate(certificate: string, address: string): Promise<boolean> {
  console.log('⚠️ X509 certificate import not fully implemented for address:', address);
  return false;
}

/**
 * Extract key fingerprint from different key types.
 */
export async function extractKeyFingerprint(
  publicKey: string,
  keyType: KeyType
): Promise<string | null> {
  try {
    switch (keyType) {
      case KeyType.PGPv4:
        const openpgp = await import('openpgp');
        const key = await openpgp.readKey({ armoredKey: publicKey });
        return key.getFingerprint().toUpperCase();

      case KeyType.SSHEd25519:
      case KeyType.SSHSecp256k1:
        return publicKey.trim();

      case KeyType.X509:
        return null; // Placeholder

      default:
        return null;
    }
  } catch (error) {
    console.error('Failed to extract key fingerprint:', error);
    return null;
  }
}
