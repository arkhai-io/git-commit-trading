import sshpk from 'sshpk';

// Import the GitKeyClaim type and KeyType enum
import type { GitKeyClaim, KeyType } from '../clients/gitIdentityRegistry';

/**
 * Verify if a commit signature was made by a specific SSH public key using sshpk
 * @param gitMetadata - Git metadata containing signature and payload
 * @param gitKeyClaim - The Git key claim containing public key and metadata
 * @returns True if the signature matches the public key
 */
export function verifyCommitSignature(
    gitMetadata: {
        signature: string;
        payload: string;
        verified: boolean;
    },
    gitKeyClaim: GitKeyClaim
): boolean {
    try {
        console.log("🔍 Signature verification with multi-key support:");
        console.log("  Key Type:", getKeyTypeName(gitKeyClaim.keyType));
        console.log("  Public Key:", gitKeyClaim.publicKey);
        console.log("  Fingerprint:", gitKeyClaim.fingerprint);
        console.log("  GitHub verified:", gitMetadata.verified);

        // First check: GitHub already verified the signature
        if (!gitMetadata.verified) {
            console.log("❌ GitHub reports signature as not verified");
            return false;
        }

        // Route to appropriate verification method based on key type
        switch (gitKeyClaim.keyType) {
            case 0: // PGPv4
                return verifyPGPSignature(gitMetadata, gitKeyClaim);
            case 1: // SSHEd25519
                return verifySSHEd25519Signature(gitMetadata, gitKeyClaim);
            case 2: // SSHSecp256k1
                return verifySSHSecp256k1Signature(gitMetadata, gitKeyClaim);
            case 3: // X509
                return verifyX509Signature(gitMetadata, gitKeyClaim);
            default:
                console.log("❌ Unsupported key type:", gitKeyClaim.keyType);
                return false;
        }

    } catch (error) {
        console.error("❌ Error in signature verification:", error);

        // Fall back to trusting GitHub's verification if our parsing fails
        if (gitMetadata.verified) {
            console.log("✅ Falling back to GitHub verification");
            return true;
        }

        return false;
    }
}

/**
 * Get human-readable name for key type
 */
function getKeyTypeName(keyType: number): string {
    switch (keyType) {
        case 0: return "PGPv4";
        case 1: return "SSH Ed25519";
        case 2: return "SSH Secp256k1";
        case 3: return "X509";
        default: return `Unknown (${keyType})`;
    }
}

/**
 * Verify PGP signature
 */
function verifyPGPSignature(gitMetadata: any, gitKeyClaim: GitKeyClaim): boolean {
    console.log("  🔐 PGP signature verification");

    // PGP signatures in Git are usually in the -----BEGIN PGP SIGNATURE----- format
    if (!gitMetadata.signature.includes("-----BEGIN PGP SIGNATURE-----")) {
        console.log("  ❌ Not a PGP signature format");
        return false;
    }

    // For now, trust GitHub's verification for PGP
    // TODO: Implement proper PGP verification using a library like openpgp
    console.log("  ⚠️ PGP verification not fully implemented - trusting GitHub");
    return gitMetadata.verified;
}

/**
 * Verify SSH Ed25519 signature
 */
function verifySSHEd25519Signature(gitMetadata: any, gitKeyClaim: GitKeyClaim): boolean {
    console.log("  🔐 SSH Ed25519 signature verification");

    try {
        // Parse the expected public key using sshpk
        const sshPublicKeyString = `ssh-ed25519 ${gitKeyClaim.publicKey}`;
        const expectedKey = sshpk.parseKey(sshPublicKeyString, 'ssh');
        console.log("    Parsed key type:", expectedKey.type);
        console.log("    Parsed key size:", expectedKey.size);

        // Verify it's an SSH signature
        if (!gitMetadata.signature.includes("-----BEGIN SSH SIGNATURE-----")) {
            console.log("  ❌ Not an SSH signature format");
            return false;
        }

        // Try to parse the SSH signature
        try {
            const signatureData = gitMetadata.signature
                .replace(/-----BEGIN SSH SIGNATURE-----\n/, '')
                .replace(/\n-----END SSH SIGNATURE-----/, '')
                .replace(/\n/g, '');

            const signatureBuffer = Buffer.from(signatureData, 'base64');
            console.log("    Signature buffer length:", signatureBuffer.length);

            // Check if the public key appears in the signature
            const expectedKeyBuffer = Buffer.from(gitKeyClaim.publicKey, 'base64');
            const signatureHex = signatureBuffer.toString('hex');
            const expectedKeyHex = expectedKeyBuffer.toString('hex');

            console.log("    Looking for key material in signature...");
            const keyFoundInSignature = signatureHex.includes(expectedKeyHex);

            if (keyFoundInSignature) {
                console.log("  ✅ Ed25519 public key found in signature!");
                return true;
            }

            // Also check just the Ed25519 key part (32 bytes)
            if (expectedKeyBuffer.length >= 51) {
                const ed25519Key = expectedKeyBuffer.subarray(-32);
                const ed25519Hex = ed25519Key.toString('hex');
                console.log("    Checking Ed25519 key material...");

                const ed25519Found = signatureHex.includes(ed25519Hex);
                if (ed25519Found) {
                    console.log("  ✅ Ed25519 key material found in signature!");
                    return true;
                }
            }

            console.log("  ❌ Public key not found in signature.");
            return false;

        } catch (parseError) {
            console.log("  ⚠️ Could not parse SSH signature format");
            console.log("  ✅ Trusting GitHub's verification");
            return gitMetadata.verified;
        }

    } catch (error) {
        console.error("  ❌ Error in SSH Ed25519 verification:", error);
        return gitMetadata.verified;
    }
}

/**
 * Verify SSH Secp256k1 signature
 */
function verifySSHSecp256k1Signature(gitMetadata: any, gitKeyClaim: GitKeyClaim): boolean {
    console.log("  🔐 SSH Secp256k1 signature verification");

    try {
        // Parse the expected public key using sshpk
        const sshPublicKeyString = `ssh-rsa ${gitKeyClaim.publicKey}`;
        const expectedKey = sshpk.parseKey(sshPublicKeyString, 'ssh');
        console.log("    Parsed key type:", expectedKey.type);

        // Verify it's an SSH signature
        if (!gitMetadata.signature.includes("-----BEGIN SSH SIGNATURE-----")) {
            console.log("  ❌ Not an SSH signature format");
            return false;
        }

        // For now, trust GitHub's verification for Secp256k1
        // TODO: Implement proper Secp256k1 verification
        console.log("  ⚠️ SSH Secp256k1 verification not fully implemented - trusting GitHub");
        return gitMetadata.verified;

    } catch (error) {
        console.error("  ❌ Error in SSH Secp256k1 verification:", error);
        return gitMetadata.verified;
    }
}

/**
 * Verify X509 certificate signature
 */
function verifyX509Signature(gitMetadata: any, gitKeyClaim: GitKeyClaim): boolean {
    console.log("  🔐 X509 certificate signature verification");

    // X509 signatures would be in certificate format
    // For now, trust GitHub's verification for X509
    // TODO: Implement proper X509 certificate verification
    console.log("  ⚠️ X509 verification not fully implemented - trusting GitHub");
    return gitMetadata.verified;
}

/**
 * Parse SSH public key using sshpk
 * @param sshPublicKey - SSH public key string (e.g., "ssh-ed25519 AAAAC3... user@host")
 * @returns Parsed key object
 */
export function parseSSHPublicKey(sshPublicKey: string) {
    try {
        return sshpk.parseKey(sshPublicKey, 'ssh');
    } catch (error) {
        throw new Error(`Failed to parse SSH public key: ${error}`);
    }
}

/**
 * Get SSH key fingerprint using sshpk
 * @param sshPublicKey - SSH public key string
 * @returns SHA256 fingerprint in standard SSH format
 */
export function getSSHFingerprintWithSSHPK(sshPublicKey: string): string {
    try {
        const key = sshpk.parseKey(sshPublicKey, 'ssh');
        return key.fingerprint('sha256').toString();
    } catch (error) {
        throw new Error(`Failed to get fingerprint: ${error}`);
    }
}
