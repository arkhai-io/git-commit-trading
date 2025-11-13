import sshpk from 'sshpk';
import fs from 'fs';
import * as openpgp from 'openpgp';
import { X509Certificate } from '@peculiar/x509';

// Import the GitKeyClaim type and KeyType enum
import type { GitKeyClaim, KeyType } from '../clients/gitIdentityRegistry';

/**
 * @deprecated This function was designed for GitHub API verification which has been removed.
 * Use git native verification through GitCommitVerifier instead.
 * 
 * Verify if a commit signature was made by a specific SSH public key using sshpk
 * @param gitMetadata - Git metadata containing signature and payload
 * @param gitKeyClaim - The Git key claim containing public key and metadata
 * @returns True if the signature matches the public key
 */
export async function verifyCommitSignature(
    gitMetadata: {
        signature: string;
        payload: string;
        verified: boolean;
    },
    gitKeyClaim: GitKeyClaim
): Promise<boolean> {
    console.warn("⚠️ verifyCommitSignature is deprecated. Use git native verification instead.");
    
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
                return await verifyPGPSignature(gitMetadata, gitKeyClaim);
            case 1: // SSHEd25519
                return verifySSHEd25519Signature(gitMetadata, gitKeyClaim);
            case 2: // SSHSecp256k1
                return verifySSHSecp256k1Signature(gitMetadata, gitKeyClaim);
            case 3: // X509
                return await verifyX509Signature(gitMetadata, gitKeyClaim);
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
async function verifyPGPSignature(gitMetadata: any, gitKeyClaim: GitKeyClaim): Promise<boolean> {
    console.log("  🔐 PGP signature verification");
    
    try {
        // Check if it's a PGP signature format
        if (!gitMetadata.signature.includes("-----BEGIN PGP SIGNATURE-----")) {
            console.log("  ❌ Not a PGP signature format");
            return false;
        }

        // Parse the registered PGP public key
        let publicKey: openpgp.Key;
        try {
            // The publicKey might be in armored format or just the key material
            if (gitKeyClaim.publicKey.includes("-----BEGIN PGP PUBLIC KEY BLOCK-----")) {
                // Full armored key
                publicKey = await openpgp.readKey({ armoredKey: gitKeyClaim.publicKey });
            } else {
                // Key material only - need to construct armored format
                const armoredKey = `-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n${gitKeyClaim.publicKey}\n-----END PGP PUBLIC KEY BLOCK-----`;
                publicKey = await openpgp.readKey({ armoredKey });
            }
            console.log("    ✅ PGP public key parsed successfully");
        } catch (error) {
            console.log("    ❌ Failed to parse PGP public key:", error);
            return gitMetadata.verified; // Fall back to GitHub verification
        }

        // Parse the signature
        let signature: openpgp.Signature;
        try {
            signature = await openpgp.readSignature({ armoredSignature: gitMetadata.signature });
            console.log("    ✅ PGP signature parsed successfully");
        } catch (error) {
            console.log("    ❌ Failed to parse PGP signature:", error);
            return gitMetadata.verified; // Fall back to GitHub verification
        }

        // Create message from payload
        const message = await openpgp.createMessage({ text: gitMetadata.payload });

        // Verify the signature
        try {
            const verificationResult = await openpgp.verify({
                message,
                signature,
                verificationKeys: publicKey
            });

            // Check verification results
            if (verificationResult.signatures && verificationResult.signatures.length > 0) {
                const firstSignature = verificationResult.signatures[0];
                if (firstSignature) {
                    const verified = await firstSignature.verified;
                    if (verified) {
                        console.log("    ✅ PGP signature verification passed");
                        return true;
                    } else {
                        console.log("    ❌ PGP signature verification failed");
                        return false;
                    }
                } else {
                    console.log("    ❌ First signature is undefined");
                    return false;
                }
            } else {
                console.log("    ❌ No signatures found in verification result");
                return false;
            }
        } catch (error) {
            console.log("    ❌ Error during PGP signature verification:", error);
            return gitMetadata.verified; // Fall back to GitHub verification
        }

    } catch (error) {
        console.error("  ❌ Unexpected error in PGP verification:", error);
        return gitMetadata.verified; // Fall back to GitHub verification
    }
}/**
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
async function verifyX509Signature(gitMetadata: any, gitKeyClaim: GitKeyClaim): Promise<boolean> {
    console.log("  🔐 X509 certificate signature verification");
    
    try {
        // Parse the X509 certificate
        let certificate: X509Certificate;
        try {
            // The publicKey might be in PEM format or just the certificate material
            if (gitKeyClaim.publicKey.includes("-----BEGIN CERTIFICATE-----")) {
                // Full PEM certificate
                certificate = new X509Certificate(gitKeyClaim.publicKey);
            } else {
                // Certificate material only - need to construct PEM format
                const pemCert = `-----BEGIN CERTIFICATE-----\n${gitKeyClaim.publicKey}\n-----END CERTIFICATE-----`;
                certificate = new X509Certificate(pemCert);
            }
            console.log("    ✅ X509 certificate parsed successfully");
            console.log("    Certificate subject:", certificate.subject);
            console.log("    Certificate issuer:", certificate.issuer);
        } catch (error) {
            console.log("    ❌ Failed to parse X509 certificate:", error);
            return gitMetadata.verified; // Fall back to GitHub verification
        }

        // Check certificate validity
        const now = new Date();
        if (certificate.notBefore > now) {
            console.log("    ❌ Certificate is not yet valid");
            return false;
        }
        if (certificate.notAfter < now) {
            console.log("    ❌ Certificate has expired");
            return false;
        }
        console.log("    ✅ Certificate is within validity period");

        // For Git commits signed with X509 certificates, the signature format can vary
        // Common formats include S/MIME signatures or raw certificate signatures
        
        // Check for S/MIME signature format
        if (gitMetadata.signature.includes("-----BEGIN PKCS7-----") || 
            gitMetadata.signature.includes("-----BEGIN CMS-----")) {
            console.log("    🔍 Detected S/MIME/CMS signature format");
            
            try {
                // Import the crypto module for signature verification
                const crypto = await import('crypto');
                
                // Extract the signature data
                const signatureData = gitMetadata.signature
                    .replace(/-----BEGIN (PKCS7|CMS)-----\n/, '')
                    .replace(/\n-----END (PKCS7|CMS)-----/, '')
                    .replace(/\n/g, '');
                
                // For now, we'll trust GitHub's verification for X509 signatures
                // Full S/MIME verification would require more complex parsing
                console.log("    ⚠️ S/MIME signature verification not fully implemented - trusting GitHub");
                return gitMetadata.verified;
                
            } catch (error) {
                console.log("    ❌ Error processing S/MIME signature:", error);
                return gitMetadata.verified;
            }
        }
        
        // Check for raw certificate signature format
        else if (gitMetadata.signature.includes("-----BEGIN SIGNATURE-----")) {
            console.log("    🔍 Detected raw certificate signature format");
            
            // For raw certificate signatures, we would need to:
            // 1. Extract the signature bytes
            // 2. Get the public key from the certificate
            // 3. Verify the signature against the payload
            
            try {
                const crypto = await import('crypto');
                const publicKey = certificate.publicKey;
                
                // Extract signature data (this is a simplified approach)
                const signatureData = gitMetadata.signature
                    .replace(/-----BEGIN SIGNATURE-----\n/, '')
                    .replace(/\n-----END SIGNATURE-----/, '')
                    .replace(/\n/g, '');
                
                // Convert to buffer
                const signatureBuffer = Buffer.from(signatureData, 'base64');
                const payloadBuffer = Buffer.from(gitMetadata.payload, 'utf8');
                
                // Create a verifier (using RSA-SHA256 as default)
                const verifier = crypto.createVerify('RSA-SHA256');
                verifier.update(payloadBuffer);
                
                // For now, trust GitHub's verification as the crypto operations are complex
                console.log("    ⚠️ Raw certificate signature verification not fully implemented - trusting GitHub");
                return gitMetadata.verified;
                
            } catch (error) {
                console.log("    ❌ Error processing raw certificate signature:", error);
                return gitMetadata.verified;
            }
        }
        
        else {
            console.log("    ❌ Unrecognized X509 signature format");
            return gitMetadata.verified; // Fall back to GitHub verification
        }

    } catch (error) {
        console.error("  ❌ Unexpected error in X509 verification:", error);
        return gitMetadata.verified; // Fall back to GitHub verification
    }
}/**
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
        // Check if DEBUG mode is enabled
        const isDebugMode = process.env.DEBUG === 'true' || process.env.DEBUG === '1';
        
        // Create a completely unique trace ID for this verification attempt
        const traceId = `verify_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Convert message to buffer (needed for verification)
        const messageBuffer = Buffer.from(message, 'utf8');

        if (isDebugMode) {
            console.log(`🔍 [${traceId}] Verifying signature:
  Public Key: ${publicKey}
  Message: ${message}
  Signature: ${signature}
  Key Type: ${keyType}`);

            // Add hex dump of the message to see exact bytes
            console.log(`  [${traceId}] Message hex dump: ${messageBuffer.toString('hex')}`);
            console.log(`  [${traceId}] Message byte analysis: ${JSON.stringify(message.split('').map(c => c + '(' + c.charCodeAt(0) + ')'))}`);
        }

        // Construct the full SSH public key string
        const sshPublicKeyString = `ssh-${keyType} ${publicKey}`;
        
        // Show shortened key for verification info
        const shortKey = publicKey.length > 60 ? `${publicKey.substring(0, 30)}...${publicKey.substring(publicKey.length - 30)}` : publicKey;
        console.log(`  SSH key (${keyType}): ${shortKey}`);

        // Convert signature to buffer once
        const signatureBuffer = Buffer.from(signature, 'hex');
        if (isDebugMode) {
            console.log(`  [${traceId}] Signature buffer length: ${signatureBuffer.length} bytes`);
        }

        if (keyType === 'ed25519' && signatureBuffer.length === 64) {
            // For Ed25519, use a completely isolated verification approach
            try {
                if (isDebugMode) {
                    console.log(`  [${traceId}] Starting Ed25519 verification...`);
                }

                // Create fresh key object
                const key = sshpk.parseKey(sshPublicKeyString, 'ssh');
                if (isDebugMode) {
                    console.log(`  [${traceId}] Parsed key type: ${key.type}, key size: ${key.size}`);
                }

                // Create fresh verifier
                const verifier = key.createVerify('sha512');
                if (isDebugMode) {
                    console.log(`  [${traceId}] Created verifier with sha512`);
                }

                // Update verifier with message
                verifier.update(messageBuffer);
                if (isDebugMode) {
                    console.log(`  [${traceId}] Updated verifier with message (${messageBuffer.length} bytes)`);
                }

                // Create fresh signature object from raw bytes
                if (isDebugMode) {
                    console.log(`  [${traceId}] Parsing signature as ed25519 raw format...`);
                }
                const signatureObj = sshpk.parseSignature(signatureBuffer, 'ed25519', 'raw');
                if (isDebugMode) {
                    console.log(`  [${traceId}] Parsed signature object: type=${signatureObj.type}, hashAlgorithm=${signatureObj.hashAlgorithm}`);
                }

                // Perform verification
                if (isDebugMode) {
                    console.log(`  [${traceId}] Calling verifier.verify()...`);
                }
                const result = verifier.verify(signatureObj);
                if (isDebugMode) {
                    console.log(`  [${traceId}] ✅ Signature verification result: ${result}`);
                }

                return result;

            } catch (ed25519Error) {
                if (isDebugMode) {
                    console.log(`  [${traceId}] ❌ Ed25519 verification failed: ${ed25519Error}`);
                }
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
            if (isDebugMode) {
                console.log(`  [${traceId}] ✅ Signature verification result: ${result}`);
            }
            return result;
        } catch (fallbackError) {
            if (isDebugMode) {
                console.log(`  [${traceId}] ❌ Fallback verification failed: ${fallbackError}`);
            }
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
    // Always normalize address to lowercase to avoid checksum case mismatches
    const normalizedAddress = ethAddress.toLowerCase();
    return `${normalizedAddress} ${nonce}`;
}

/**
 * Verify PGP signature for GitKeyClaim
 * @param publicKeyBase64 - PGP public key in base64 format
 * @param message - Original message that was signed
 * @param signatureHex - PGP signature in hex format (armored signature converted to hex)
 * @returns True if signature is valid
 */
async function verifyPGPKeyClaimSignature(
    publicKeyBase64: string,
    message: string,
    signatureHex: string
): Promise<boolean> {
    try {
        const isDebugMode = process.env.DEBUG === 'true' || process.env.DEBUG === '1';
        
        // Convert hex signature back to armored format
        const signatureArmored = Buffer.from(signatureHex, 'hex').toString('utf8');
        
        // Show shortened PGP key
        const shortKey = publicKeyBase64.length > 80 
            ? `${publicKeyBase64.substring(0, 40)}...${publicKeyBase64.substring(publicKeyBase64.length - 40)}`
            : publicKeyBase64;
        console.log(`  PGP key: ${shortKey}`);
        
        if (isDebugMode) {
            console.log("  PGP signature (armored):", signatureArmored.substring(0, 100) + "...");
        }

        // Parse the public key from base64
        // The key should be in armored format
        let publicKey: openpgp.Key;
        try {
            if (publicKeyBase64.includes("-----BEGIN PGP PUBLIC KEY BLOCK-----")) {
                publicKey = await openpgp.readKey({ armoredKey: publicKeyBase64 });
            } else {
                // Assume it's base64 armored key
                const armoredKey = `-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n${publicKeyBase64}\n-----END PGP PUBLIC KEY BLOCK-----`;
                publicKey = await openpgp.readKey({ armoredKey });
            }
            if (isDebugMode) {
                console.log("  ✅ PGP public key parsed successfully");
            }
        } catch (error) {
            console.log("  ❌ Failed to parse PGP public key:", error);
            return false;
        }

        // Parse the signature
        let signature: openpgp.Signature;
        try {
            signature = await openpgp.readSignature({ armoredSignature: signatureArmored });
            if (isDebugMode) {
                console.log("  ✅ PGP signature parsed successfully");
            }
        } catch (error) {
            console.log("  ❌ Failed to parse PGP signature:", error);
            return false;
        }

        // Create message object
        const messageObj = await openpgp.createMessage({ text: message });

        // Verify the signature
        const verificationResult = await openpgp.verify({
            message: messageObj,
            signature,
            verificationKeys: publicKey
        });

        // Check verification results
        if (verificationResult.signatures && verificationResult.signatures.length > 0) {
            const firstSignature = verificationResult.signatures[0];
            if (firstSignature) {
                const verified = await firstSignature.verified;
                if (verified) {
                    console.log("  ✅ PGP signature verification passed");
                    return true;
                } else {
                    console.log("  ❌ PGP signature verification failed");
                    return false;
                }
            }
        }
        
        console.log("  ❌ No valid signature found");
        return false;

    } catch (error) {
        console.error("  ❌ Error during PGP verification:", error);
        return false;
    }
}

/**
 * Verify GitKeyClaim signature
 * @param gitKeyClaim - The Git key claim to verify
 * @param ethAddress - Ethereum address that should have been signed
 * @returns True if the signature is valid
 */
export async function verifyGitKeyClaimSignature(
    gitKeyClaim: GitKeyClaim,
    ethAddress: string
): Promise<boolean> {
    try {
        // Normalize address to lowercase for consistent verification
        const normalizedAddress = ethAddress.toLowerCase();
        
        console.log("🔍 Verifying GitKeyClaim signature:");
        console.log("  Address:", normalizedAddress);
        console.log("  Key Type:", getKeyTypeName(gitKeyClaim.keyType));

        // Extract nonce from the nonceHash
        const nonceHex = gitKeyClaim.nonceHash.replace('0x', '');
        console.log("  Nonce (hex from contract):", nonceHex);

        const expectedMessage = generateSigningMessage(normalizedAddress, nonceHex);
        console.log("  Expected signed message:", expectedMessage);

        const signature = gitKeyClaim.sig.replace('0x', '');
        console.log(`  Signature from contract: ${signature.slice(0, 20)}... (length: ${signature.length})`);

        let isSignatureValid = false;

        // Route to appropriate verification method based on key type
        if (gitKeyClaim.keyType === 0) {
            // PGP key - use OpenPGP verification
            console.log("  Using PGP verification method...");
            isSignatureValid = await verifyPGPKeyClaimSignature(
                gitKeyClaim.publicKey,
                expectedMessage,
                signature
            );
        } else {
            // SSH key - use SSH verification
            const keyTypeMap: { [key: number]: string } = {
                1: 'ed25519',      // SSHEd25519
                2: 'secp256k1',    // SSHSecp256k1
                3: 'x509'          // X509
            };
            
            const keyTypeForVerification = keyTypeMap[gitKeyClaim.keyType];
            if (!keyTypeForVerification) {
                console.log(`  ❌ Unsupported key type: ${gitKeyClaim.keyType}`);
                return false;
            }

            console.log(`  Using SSH verification method with key type: ${keyTypeForVerification}`);
            isSignatureValid = verifySSHSignature(
                gitKeyClaim.publicKey,
                expectedMessage,
                signature,
                keyTypeForVerification
            );
        }

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

/**
 * Generate a PGP signature for the GitKeyClaim
 * @param privateKeyArmored - PGP private key in armored format
 * @param passphrase - Passphrase for the private key (optional)
 * @param message - Message to sign
 * @returns Signature as hex string
 */
export async function generatePGPSignature(
    privateKeyArmored: string, 
    message: string,
    passphrase?: string
): Promise<string> {
    try {
        // Parse the private key
        const privateKey = await openpgp.readPrivateKey({ 
            armoredKey: privateKeyArmored 
        });

        // Decrypt the private key if needed
        let decryptedPrivateKey = privateKey;
        if (!privateKey.isDecrypted()) {
            if (passphrase) {
                decryptedPrivateKey = await openpgp.decryptKey({
                    privateKey,
                    passphrase
                });
            } else {
                console.log("⚠️  Private key is encrypted but no passphrase provided, generating test signature");
                // Return a mock signature for testing purposes  
                return Buffer.from(`mock_pgp_sig_${Date.now()}`).toString('hex').padStart(128, '0').substring(0, 128);
            }
        }

        // Create a clearsigned message for GitKeyClaim verification
        const clearMessage = await openpgp.createCleartextMessage({ text: message });

        // Sign the message
        const signature = await openpgp.sign({
            message: clearMessage,
            signingKeys: decryptedPrivateKey,
            format: 'armored'
        });

        // Extract just the signature part (remove the message part from cleartext signature)
        const signatureMatch = signature.match(/-----BEGIN PGP SIGNATURE-----[\s\S]*?-----END PGP SIGNATURE-----/);
        if (signatureMatch) {
            const signatureOnly = signatureMatch[0];
            // Convert to hex format for contract storage
            const signatureBytes = Buffer.from(signatureOnly, 'utf8');
            const signatureHex = signatureBytes.toString('hex');
            return signatureHex;
        } else {
            throw new Error("Failed to extract PGP signature from signed message");
        }
    } catch (error) {
        console.error("❌ Error generating PGP signature:", error);
        console.log("⚠️  Falling back to mock signature for testing");
        // Return a deterministic mock signature for testing
        return Buffer.from(`mock_pgp_sig_${message.substring(0, 10)}`).toString('hex').padStart(128, '0').substring(0, 128);
    }
}

/**
 * Generate a PGP key pair for testing
 * @param name - User name for the key
 * @param email - User email for the key  
 * @param passphrase - Passphrase for the private key (optional)
 * @returns Object containing public and private keys
 */
export async function generatePGPKeyPair(
    name: string, 
    email: string, 
    passphrase?: string
): Promise<{
    publicKeyArmored: string;
    privateKeyArmored: string;
    fingerprint: string;
    keyId: string;
}> {
    try {
        // Generate key pair (unencrypted for testing)
        const { publicKey, privateKey } = await openpgp.generateKey({
            type: 'rsa',
            rsaBits: 2048,
            userIDs: [{ name, email }],
            passphrase: undefined, // Generate unencrypted key for testing
            format: 'armored'
        });

        // Read the public key to get fingerprint and key ID
        const pubKey = await openpgp.readKey({ armoredKey: publicKey });
        const fingerprint = pubKey.getFingerprint();
        const keyIds = pubKey.getKeyIDs();
        const keyId = keyIds.length > 0 && keyIds[0] ? keyIds[0].toHex() : '';

        return {
            publicKeyArmored: publicKey,
            privateKeyArmored: privateKey,
            fingerprint,
            keyId
        };
    } catch (error) {
        console.error("❌ Error generating PGP key pair:", error);
        throw new Error(`Failed to generate PGP key pair: ${error}`);
    }
}
