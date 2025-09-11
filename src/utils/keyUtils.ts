import * as openpgp from 'openpgp';
import { X509Certificate } from '@peculiar/x509';
import { KeyType } from '../clients/gitIdentityRegistry.js';

/**
 * Detect key type from key content
 * @param keyContent - The key content (could be SSH, PGP, or X509)
 * @returns KeyType enum value
 */
export function detectKeyTypeFromContent(keyContent: string): KeyType {
    const content = keyContent.trim();
    
    // SSH key detection
    if (content.includes('ssh-ed25519')) {
        return KeyType.SSHEd25519;
    } else if (content.includes('ssh-rsa') || content.includes('ssh-dss') || content.includes('ecdsa-sha2-')) {
        return KeyType.SSHSecp256k1;
    }
    
    // PGP key detection
    else if (content.includes('-----BEGIN PGP PUBLIC KEY BLOCK-----') || 
             content.includes('-----BEGIN PGP PRIVATE KEY BLOCK-----')) {
        return KeyType.PGPv4;
    }
    
    // X509 certificate detection
    else if (content.includes('-----BEGIN CERTIFICATE-----') || 
             content.includes('-----BEGIN X509 CERTIFICATE-----')) {
        return KeyType.X509;
    }
    
    // Try to detect based on base64 patterns
    else if (/^[A-Za-z0-9+/=]+$/.test(content)) {
        // Could be base64-encoded key material
        // Default to SSH Ed25519 for backward compatibility
        return KeyType.SSHEd25519;
    }
    
    else {
        throw new Error('Unable to detect key type from content. Supported formats: SSH, PGP, X509');
    }
}

/**
 * Extract key material from PGP public key
 * @param pgpKey - PGP public key in armored format
 * @returns Base64-encoded key material
 */
export async function extractPGPKeyMaterial(pgpKey: string): Promise<string> {
    try {
        const key = await openpgp.readKey({ armoredKey: pgpKey });
        
        // For GitHub integration, we might want to store the full armored key
        // or extract specific key material. For now, return the full armored key
        return pgpKey;
    } catch (error) {
        throw new Error(`Failed to parse PGP key: ${error}`);
    }
}

/**
 * Extract certificate material from X509 certificate
 * @param x509Cert - X509 certificate in PEM format
 * @returns Base64-encoded certificate material
 */
export function extractX509CertMaterial(x509Cert: string): string {
    try {
        const cert = new X509Certificate(x509Cert);
        
        // Validate certificate structure
        if (!cert.publicKey) {
            throw new Error('Certificate does not contain a public key');
        }
        
        // For GitHub integration, return the full PEM certificate
        return x509Cert;
    } catch (error) {
        throw new Error(`Failed to parse X509 certificate: ${error}`);
    }
}

/**
 * Validate PGP key format and extract metadata
 * @param pgpKey - PGP public key in armored format
 * @returns Key metadata
 */
export async function validatePGPKey(pgpKey: string): Promise<{
    keyId: string;
    fingerprint: string;
    userIds: string[];
    algorithm: string;
    keySize: number;
    creationTime: Date;
    expirationTime?: Date;
}> {
    try {
        const key = await openpgp.readKey({ armoredKey: pgpKey });
        
        const primaryUser = await key.getPrimaryUser();
        const keyPacket = key.keyPacket;
        
        const keyIds = key.getKeyIDs();
        const firstKeyId = keyIds.length > 0 ? keyIds[0] : null;
        const keyId = firstKeyId ? firstKeyId.toHex() : '';
        const expirationTime = await key.getExpirationTime();
        
        return {
            keyId,
            fingerprint: key.getFingerprint(),
            userIds: key.getUserIDs(),
            algorithm: String(keyPacket.algorithm) || 'unknown',
            keySize: (keyPacket as any).getBitSize ? (keyPacket as any).getBitSize() : 0,
            creationTime: keyPacket.created,
            expirationTime: expirationTime instanceof Date ? expirationTime : undefined
        };
    } catch (error) {
        throw new Error(`Failed to validate PGP key: ${error}`);
    }
}

/**
 * Validate X509 certificate format and extract metadata
 * @param x509Cert - X509 certificate in PEM format
 * @returns Certificate metadata
 */
export function validateX509Certificate(x509Cert: string): {
    subject: string;
    issuer: string;
    serialNumber: string;
    notBefore: Date;
    notAfter: Date;
    keyUsage?: string[];
    publicKeyAlgorithm: string;
    signatureAlgorithm: string;
} {
    try {
        const cert = new X509Certificate(x509Cert);
        
        return {
            subject: cert.subject,
            issuer: cert.issuer,
            serialNumber: cert.serialNumber,
            notBefore: cert.notBefore,
            notAfter: cert.notAfter,
            keyUsage: (cert as any).keyUsages || [],
            publicKeyAlgorithm: cert.publicKey.algorithm.name,
            signatureAlgorithm: (cert.signatureAlgorithm as any).name || 'unknown'
        };
    } catch (error) {
        throw new Error(`Failed to validate X509 certificate: ${error}`);
    }
}

/**
 * Generate key fingerprint for different key types
 * @param keyType - Type of the key
 * @param keyMaterial - Key material
 * @returns Fingerprint as hex string
 */
export async function generateKeyFingerprint(keyType: KeyType, keyMaterial: string): Promise<string> {
    const crypto = await import('crypto');
    
    switch (keyType) {
        case KeyType.PGPv4: {
            try {
                const key = await openpgp.readKey({ armoredKey: keyMaterial });
                return key.getFingerprint();
            } catch {
                // Fallback to SHA256 hash of key material
                return crypto.createHash('sha256').update(keyMaterial).digest('hex');
            }
        }
        
        case KeyType.X509: {
            try {
                const cert = new X509Certificate(keyMaterial);
                // Use SHA256 hash of the certificate
                const certBuffer = Buffer.from(keyMaterial);
                return crypto.createHash('sha256').update(certBuffer).digest('hex');
            } catch {
                // Fallback to SHA256 hash of key material
                return crypto.createHash('sha256').update(keyMaterial).digest('hex');
            }
        }
        
        case KeyType.SSHEd25519:
        case KeyType.SSHSecp256k1: {
            // For SSH keys, hash the key material
            return crypto.createHash('sha256').update(keyMaterial).digest('hex');
        }
        
        default:
            throw new Error(`Unsupported key type for fingerprint generation: ${keyType}`);
    }
}

/**
 * Format key material for storage based on key type
 * @param keyType - Type of the key
 * @param rawKeyMaterial - Raw key material
 * @returns Formatted key material suitable for storage
 */
export function formatKeyForStorage(keyType: KeyType, rawKeyMaterial: string): string {
    const content = rawKeyMaterial.trim();
    
    switch (keyType) {
        case KeyType.PGPv4:
            // Ensure PGP keys are in full armored format
            if (!content.includes('-----BEGIN PGP PUBLIC KEY BLOCK-----')) {
                throw new Error('PGP key must be in armored format');
            }
            return content;
            
        case KeyType.X509:
            // Ensure X509 certificates are in full PEM format
            if (!content.includes('-----BEGIN CERTIFICATE-----')) {
                throw new Error('X509 certificate must be in PEM format');
            }
            return content;
            
        case KeyType.SSHEd25519:
        case KeyType.SSHSecp256k1:
            // For SSH keys, extract just the base64 key material
            if (content.includes(' ')) {
                const parts = content.split(' ');
                if (parts.length >= 2 && parts[1]) {
                    return parts[1]; // Return just the base64 part
                }
            }
            return content;
            
        default:
            throw new Error(`Unsupported key type for formatting: ${keyType}`);
    }
}

/**
 * Get human-readable name for key type
 * @param keyType - KeyType enum value
 * @returns Human-readable string
 */
export function getKeyTypeName(keyType: KeyType): string {
    switch (keyType) {
        case KeyType.PGPv4: return "PGP v4";
        case KeyType.SSHEd25519: return "SSH Ed25519";
        case KeyType.SSHSecp256k1: return "SSH RSA/ECDSA";
        case KeyType.X509: return "X.509 Certificate";
        default: return `Unknown (${keyType})`;
    }
}

/**
 * Validate that a key is suitable for Git signing
 * @param keyType - Type of the key
 * @param keyMaterial - Key material
 * @returns Validation result with any warnings
 */
export async function validateKeyForGitSigning(keyType: KeyType, keyMaterial: string): Promise<{
    valid: boolean;
    warnings: string[];
    errors: string[];
}> {
    const warnings: string[] = [];
    const errors: string[] = [];
    
    try {
        switch (keyType) {
            case KeyType.PGPv4: {
                const metadata = await validatePGPKey(keyMaterial);
                
                // Check expiration
                if (metadata.expirationTime && metadata.expirationTime < new Date()) {
                    errors.push('PGP key has expired');
                } else if (metadata.expirationTime && metadata.expirationTime < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)) {
                    warnings.push('PGP key will expire within 30 days');
                }
                
                // Check key size
                if (metadata.keySize < 2048) {
                    warnings.push(`PGP key size (${metadata.keySize} bits) is below recommended 2048 bits`);
                }
                
                break;
            }
            
            case KeyType.X509: {
                const metadata = validateX509Certificate(keyMaterial);
                
                // Check validity period
                const now = new Date();
                if (metadata.notAfter < now) {
                    errors.push('X509 certificate has expired');
                } else if (metadata.notAfter < new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)) {
                    warnings.push('X509 certificate will expire within 30 days');
                }
                
                if (metadata.notBefore > now) {
                    errors.push('X509 certificate is not yet valid');
                }
                
                // Check key usage
                if (metadata.keyUsage && !metadata.keyUsage.includes('digitalSignature')) {
                    warnings.push('X509 certificate does not include digital signature key usage');
                }
                
                break;
            }
            
            case KeyType.SSHEd25519:
            case KeyType.SSHSecp256k1:
                // SSH keys don't have built-in expiration, so just validate format
                if (!keyMaterial || keyMaterial.length < 10) {
                    errors.push('SSH key material appears to be too short');
                }
                break;
                
            default:
                errors.push(`Unsupported key type: ${keyType}`);
        }
        
    } catch (error) {
        errors.push(`Key validation failed: ${error}`);
    }
    
    return {
        valid: errors.length === 0,
        warnings,
        errors
    };
}
