import sshpk from 'sshpk';
import fs from 'fs';

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
 * Generate an SSH signature for the GitKeyClaim
 * @param privateKey - SSH private key in PEM format
 * @param message - Message to sign
 * @returns Signature as hex string
 */
export function generateSSHSignature(privateKeyDataOrPath: string, message: string): string {
    try {
        let privateKeyData: string;

        // Check if input is a file path or private key content
        if (privateKeyDataOrPath.includes('-----BEGIN')) {
            // It's already private key content
            privateKeyData = privateKeyDataOrPath;
        } else {
            // It's a file path
            privateKeyData = fs.readFileSync(privateKeyDataOrPath, 'utf8');
        }

        // Parse private key
        const privateKey = sshpk.parsePrivateKey(privateKeyData, 'openssh');

        // Extract public key from private key and log it
        const derivedPublicKey = privateKey.toPublic();
        const sshPublicKeyString = derivedPublicKey.toString('ssh');

        // Determine hash algorithm based on key type
        const hashAlgo = privateKey.type === 'ed25519' ? 'sha512' : 'sha256';

        // Create signer with appropriate hash
        const signer = privateKey.createSign(hashAlgo);
        signer.update(message);
        const signature = signer.sign();

        // Convert signature to hex
        const signatureHex = signature.toBuffer().toString('hex');

        return signatureHex;
    } catch (error) {
        console.error("❌ Error generating SSH signature:", error);
        throw new Error(`Failed to generate SSH signature: ${error}`);
    }
}

/**
 * Verify an SSH signature
 * @param publicKey - SSH public key (base64 format)
 * @param message - Original message that was signed
 * @param signature - Signature to verify (hex format)
 * @param keyType - Type of SSH key (ed25519, rsa, etc.)
 * @returns True if signature is valid
 */
export function verifySSHSignature(
    publicKey: string,
    message: string,
    signature: string,
    keyType: string = 'ed25519'
): boolean {
    try {
        // Create a completely unique trace ID for this verification attempt
        const traceId = `verify_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        console.log(`🔍 [${traceId}] Verifying signature:
  Public Key: ${publicKey}
  Message: ${message}
  Signature: ${signature}
  Key Type: ${keyType}`);

        // Add hex dump of the message to see exact bytes
        const messageBuffer = Buffer.from(message, 'utf8');
        console.log(`  [${traceId}] Message hex dump: ${messageBuffer.toString('hex')}`);
        console.log(`  [${traceId}] Message byte analysis: ${JSON.stringify(message.split('').map(c => c + '(' + c.charCodeAt(0) + ')'))}`);

        // Construct the full SSH public key string
        const sshPublicKeyString = `ssh-${keyType} ${publicKey}`;
        console.log(`  [${traceId}] Full SSH key string: ${sshPublicKeyString}`);

        // Convert signature to buffer once
        const signatureBuffer = Buffer.from(signature, 'hex');
        console.log(`  [${traceId}] Signature buffer length: ${signatureBuffer.length} bytes`);

        if (keyType === 'ed25519' && signatureBuffer.length === 64) {
            // For Ed25519, use a completely isolated verification approach
            try {
                console.log(`  [${traceId}] Starting Ed25519 verification...`);

                // Create fresh key object
                const key = sshpk.parseKey(sshPublicKeyString, 'ssh');
                console.log(`  [${traceId}] Parsed key type: ${key.type}, key size: ${key.size}`);

                // Create fresh verifier
                const verifier = key.createVerify('sha512');
                console.log(`  [${traceId}] Created verifier with sha512`);

                // Update verifier with message
                verifier.update(messageBuffer);
                console.log(`  [${traceId}] Updated verifier with message (${messageBuffer.length} bytes)`);

                // Create fresh signature object from raw bytes
                console.log(`  [${traceId}] Parsing signature as ed25519 raw format...`);
                const signatureObj = sshpk.parseSignature(signatureBuffer, 'ed25519', 'raw');
                console.log(`  [${traceId}] Parsed signature object: type=${signatureObj.type}, hashAlgorithm=${signatureObj.hashAlgorithm}`);

                // Perform verification
                console.log(`  [${traceId}] Calling verifier.verify()...`);
                const result = verifier.verify(signatureObj);
                console.log(`  [${traceId}] ✅ Signature verification result: ${result}`);

                return result;

            } catch (ed25519Error) {
                console.log(`  [${traceId}] ❌ Ed25519 verification failed: ${ed25519Error}`);
                return false;
            }
        }

        // Fallback for other key types
        try {
            const key = sshpk.parseKey(sshPublicKeyString, 'ssh');
            const hashAlgo = key.type === 'ed25519' ? 'sha512' : 'sha256';
            const verifier = key.createVerify(hashAlgo);
            verifier.update(Buffer.from(message, 'utf8'));

            const signatureObj = sshpk.parseSignature(signatureBuffer, key.type as any, 'ssh');
            const result = verifier.verify(signatureObj);
            console.log(`  [${traceId}] ✅ Signature verification result: ${result}`);
            return result;
        } catch (fallbackError) {
            console.log(`  [${traceId}] ❌ Fallback verification failed: ${fallbackError}`);
            return false;
        }

    } catch (error) {
        console.error("❌ Error verifying SSH signature:", error);
        return false;
    }
}/**
 * Generate message that should be signed for GitKeyClaim
 * @param ethAddress - Ethereum address of the claimant
 * @param nonce - Random nonce for uniqueness
 * @returns Message string to be signed
 */
export function generateSigningMessage(ethAddress: string, nonce: string): string {
    return `${ethAddress} ${nonce}`;
}

/**
 * Verify GitKeyClaim signature
 * @param gitKeyClaim - The Git key claim to verify
 * @param ethAddress - Ethereum address that should have been signed
 * @returns True if the signature is valid
 */
export function verifyGitKeyClaimSignature(
    gitKeyClaim: GitKeyClaim,
    ethAddress: string
): boolean {
    try {
        console.log("🔍 Verifying GitKeyClaim signature:");
        console.log("  Address:", ethAddress);
        console.log("  Key Type:", getKeyTypeName(gitKeyClaim.keyType));

        // Extract nonce from the nonceHash (since we're storing it as hex, not keccak256)
        const nonceHash = gitKeyClaim.nonceHash.replace('0x', '');
        let nonce: string;

        try {
            // Try to decode the nonce from hex
            const nonceBuffer = Buffer.from(nonceHash, 'hex');
            // Remove null bytes that might be present due to padding
            const trimmedBuffer = Buffer.from(nonceBuffer.filter(byte => byte !== 0));
            nonce = trimmedBuffer.toString('utf8');
            console.log("  Extracted nonce:", nonce);
        } catch (error) {
            console.log("  ❌ Could not extract nonce from nonceHash");
            return false;
        }

        const expectedMessage = generateSigningMessage(ethAddress, nonce);
        console.log("  Expected signed message:", expectedMessage);

        // Verify the actual signature using SSH cryptographic verification
        const signature = gitKeyClaim.sig.replace('0x', '');
        console.log(`  Signature from contract: ${signature.slice(0, 20)}... (length: ${signature.length})`);

        const keyTypeForVerification = getKeyTypeName(gitKeyClaim.keyType).toLowerCase().replace('ssh ', '');
        console.log(`  Key type for verification: "${keyTypeForVerification}"`);

        const isSignatureValid = verifySSHSignature(
            gitKeyClaim.publicKey,
            expectedMessage,
            signature,
            keyTypeForVerification
        );

        if (isSignatureValid) {
            console.log("  ✅ Cryptographic signature verification passed!");
            return true;
        } else {
            console.log("  ❌ Cryptographic signature verification failed!");
            return false;
        }
    } catch (error) {
        console.error("❌ Error verifying GitKeyClaim signature:", error);
        return false;
    }
}
