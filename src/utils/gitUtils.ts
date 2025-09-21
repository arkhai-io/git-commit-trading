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

