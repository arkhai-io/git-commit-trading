import { createHash } from "crypto";
import sshpk from "sshpk";

/**
 * Calculate SHA256 fingerprint from SSH Ed25519 public key using sshpk
 * This matches the standard SSH fingerprint calculation
 * @param sshPublicKey - The full SSH public key string (e.g., "ssh-ed25519 AAAAC3... user@host")
 * @returns The SHA256 fingerprint as hex string (without 0x prefix)
 */
export function calculateSSHFingerprint(sshPublicKey: string): string {
    try {
        // Use sshpk to parse and get fingerprint
        const key = sshpk.parseKey(sshPublicKey, 'ssh');
        const fingerprint = key.fingerprint('sha256');

        // Convert from sshpk format to hex
        const base64Hash = fingerprint.toString().replace('SHA256:', '');
        const buffer = Buffer.from(base64Hash, 'base64');
        return buffer.toString('hex');
    } catch (error) {
        // Fallback to manual calculation if sshpk fails
        console.warn("sshpk parsing failed, falling back to manual calculation:", error);
        return calculateSSHFingerprintManual(sshPublicKey);
    }
}

/**
 * Manual SSH fingerprint calculation (fallback)
 * @param sshPublicKey - The full SSH public key string
 * @returns The SHA256 fingerprint as hex string
 */
function calculateSSHFingerprintManual(sshPublicKey: string): string {
    // Parse the SSH public key format: "ssh-ed25519 <base64-key> <comment>"
    const parts = sshPublicKey.trim().split(' ');
    if (parts.length < 2) {
        throw new Error('Invalid SSH public key format');
    }

    const keyType = parts[0];
    const base64Key = parts[1];

    if (!keyType || !base64Key) {
        throw new Error('Invalid SSH public key format - missing key type or key data');
    }

    if (keyType !== 'ssh-ed25519') {
        throw new Error('Only ssh-ed25519 keys are supported');
    }

    // Decode the base64 key data - this is the SSH wire format
    const wireFormatBuffer = Buffer.from(base64Key, 'base64');

    // Calculate SHA256 hash of the wire format (this is how SSH does it)
    const hash = createHash('sha256');
    hash.update(wireFormatBuffer);

    return hash.digest('hex');
}

/**
 * Get SSH fingerprint in the standard SSH format (SHA256:base64) using sshpk
 * @param sshPublicKey - The full SSH public key string
 * @returns The fingerprint in SSH format like "SHA256:5JNpw1y+TShTIRLyOvOO55vqizJLSWd6Ip5rbhJqah0"
 */
export function getSSHFingerprintFormatted(sshPublicKey: string): string {
    try {
        // Use sshpk for proper SSH fingerprint format
        const key = sshpk.parseKey(sshPublicKey, 'ssh');
        return key.fingerprint('sha256').toString();
    } catch (error) {
        // Fallback to manual calculation
        console.warn("sshpk parsing failed, falling back to manual calculation:", error);
        const hexFingerprint = calculateSSHFingerprintManual(sshPublicKey);
        const buffer = Buffer.from(hexFingerprint, 'hex');
        const base64Fingerprint = buffer.toString('base64').replace(/=+$/, ''); // Remove padding
        return `SHA256:${base64Fingerprint}`;
    }
}

/**
 * Extract just the base64 key material from SSH public key
 * @param sshPublicKey - The full SSH public key string
 * @returns Just the base64-encoded key material (without algorithm prefix or comment)
 */
export function extractSSHKeyMaterial(sshPublicKey: string): string {
    const parts = sshPublicKey.trim().split(' ');
    if (parts.length < 2) {
        throw new Error('Invalid SSH public key format');
    }

    const base64Key = parts[1];

    if (!base64Key) {
        throw new Error('Invalid SSH public key format - missing key data');
    }

    return base64Key;
}

/**
 * Extract the Ed25519 public key bytes from SSH public key
 * @param sshPublicKey - The full SSH public key string
 * @returns The 32-byte Ed25519 public key as Buffer
 */
export function extractEd25519PublicKey(sshPublicKey: string): Buffer {
    const parts = sshPublicKey.trim().split(' ');
    if (parts.length < 2) {
        throw new Error('Invalid SSH public key format');
    }

    const base64Key = parts[1];

    if (!base64Key) {
        throw new Error('Invalid SSH public key format - missing key data');
    }

    const keyBuffer = Buffer.from(base64Key, 'base64');

    // SSH wire format for Ed25519:
    // - 4 bytes: length of algorithm name (11 for "ssh-ed25519")
    // - 11 bytes: algorithm name "ssh-ed25519"
    // - 4 bytes: length of public key (32 for Ed25519)
    // - 32 bytes: the actual Ed25519 public key

    if (keyBuffer.length < 51) { // 4 + 11 + 4 + 32 = 51
        throw new Error('Invalid SSH Ed25519 key length');
    }

    // Skip the algorithm name part and extract the 32-byte public key
    const publicKeyLength = keyBuffer.readUInt32BE(15); // Read length at offset 15
    if (publicKeyLength !== 32) {
        throw new Error('Invalid Ed25519 public key length');
    }

    return keyBuffer.subarray(19, 51); // Extract 32 bytes starting at offset 19
}
