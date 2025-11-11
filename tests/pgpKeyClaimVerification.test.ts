import { describe, test, expect } from "bun:test";
import { generatePGPSignature, verifyGitKeyClaimSignature, generateSigningMessage } from "../src/utils/sshSignatureUtils";
import { KeyType } from "../src/clients/gitIdentityRegistry";
import * as openpgp from 'openpgp';

describe("PGP Key Claim Signature", () => {
    test("should generate and verify PGP signature for GitKeyClaim", async () => {
        console.log("🧪 Testing PGP GitKeyClaim signature generation and verification");
        
        // Generate a test PGP key pair
        console.log("  Generating test PGP key pair...");
        const { privateKey: privateKeyArmored, publicKey: publicKeyArmored } = await openpgp.generateKey({
            type: 'rsa',
            rsaBits: 2048,
            userIDs: [{ name: 'Test User', email: 'test@example.com' }],
            passphrase: 'test-passphrase',
            format: 'armored'
        });
        console.log("  ✅ PGP key pair generated");
        
        // Create a signing message (as done in registration)
        const ethAddress = "0x1234567890123456789012345678901234567890";
        const timestamp = Date.now();
        const crypto = await import('crypto');
        const randomPart = crypto.randomBytes(24).toString('hex');
        const timestampHex = timestamp.toString(16).padStart(16, '0');
        const nonceHex = timestampHex + randomPart;
        const nonceHash = '0x' + nonceHex;
        
        const signingMessage = generateSigningMessage(ethAddress, nonceHex);
        console.log(`  Signing message: ${signingMessage}`);
        
        // Generate signature
        console.log("  Generating PGP signature...");
        const signatureHex = await generatePGPSignature(privateKeyArmored, signingMessage, 'test-passphrase');
        console.log(`  ✅ Signature generated (${signatureHex.length} hex chars)`);
        
        // Verify the signature can be decoded back
        const signatureBuffer = Buffer.from(signatureHex, 'hex');
        const armoredSignature = signatureBuffer.toString('utf8');
        console.log(`  Decoded signature format: ${armoredSignature.substring(0, 50)}...`);
        
        // Create a mock GitKeyClaim
        const gitKeyClaim = {
            keyType: KeyType.PGPv4,
            nonceHash: nonceHash as `0x${string}`,
            sig: ('0x' + signatureHex) as `0x${string}`,
            publicKey: publicKeyArmored
        };
        
        // Verify the signature
        console.log("  Verifying GitKeyClaim signature...");
        const isValid = await verifyGitKeyClaimSignature(gitKeyClaim, ethAddress);
        
        expect(isValid).toBe(true);
        console.log("  ✅ Signature verification passed!");
    }, 30000); // 30 second timeout for key generation
    
    test("should reject invalid PGP signature", async () => {
        console.log("🧪 Testing PGP GitKeyClaim signature rejection");
        
        // Generate a test PGP key pair
        const { privateKey: privateKeyArmored, publicKey: publicKeyArmored } = await openpgp.generateKey({
            type: 'rsa',
            rsaBits: 2048,
            userIDs: [{ name: 'Test User', email: 'test@example.com' }],
            passphrase: 'test-passphrase',
            format: 'armored'
        });
        
        // Create a signing message
        const ethAddress = "0x1234567890123456789012345678901234567890";
        const nonceHex = "0".repeat(64);
        const signingMessage = generateSigningMessage(ethAddress, nonceHex);
        
        // Generate signature for the correct message
        const signatureHex = await generatePGPSignature(privateKeyArmored, signingMessage, 'test-passphrase');
        
        // Create a mock GitKeyClaim
        const gitKeyClaim = {
            keyType: KeyType.PGPv4,
            nonceHash: ('0x' + nonceHex) as `0x${string}`,
            sig: ('0x' + signatureHex) as `0x${string}`,
            publicKey: publicKeyArmored
        };
        
        // Try to verify with a DIFFERENT ethereum address (should fail)
        const differentAddress = "0x9999999999999999999999999999999999999999";
        console.log("  Verifying with different address (should fail)...");
        const isValid = await verifyGitKeyClaimSignature(gitKeyClaim, differentAddress);
        
        expect(isValid).toBe(false);
        console.log("  ✅ Invalid signature correctly rejected!");
    }, 30000);
    
    test("should reject signature from different key", async () => {
        console.log("🧪 Testing PGP GitKeyClaim with wrong key");
        
        // Generate two different key pairs
        const { privateKey: privateKey1 } = await openpgp.generateKey({
            type: 'rsa',
            rsaBits: 2048,
            userIDs: [{ name: 'User 1', email: 'user1@example.com' }],
            passphrase: 'pass1',
            format: 'armored'
        });
        
        const { publicKey: publicKey2 } = await openpgp.generateKey({
            type: 'rsa',
            rsaBits: 2048,
            userIDs: [{ name: 'User 2', email: 'user2@example.com' }],
            passphrase: 'pass2',
            format: 'armored'
        });
        
        // Create and sign message with key 1
        const ethAddress = "0x1234567890123456789012345678901234567890";
        const nonceHex = "0".repeat(64);
        const signingMessage = generateSigningMessage(ethAddress, nonceHex);
        const signatureHex = await generatePGPSignature(privateKey1, signingMessage, 'pass1');
        
        // Create claim with signature from key 1 but public key from key 2
        const gitKeyClaim = {
            keyType: KeyType.PGPv4,
            nonceHash: ('0x' + nonceHex) as `0x${string}`,
            sig: ('0x' + signatureHex) as `0x${string}`,
            publicKey: publicKey2  // Wrong public key!
        };
        
        // Verification should fail
        console.log("  Verifying signature with wrong public key (should fail)...");
        const isValid = await verifyGitKeyClaimSignature(gitKeyClaim, ethAddress);
        
        expect(isValid).toBe(false);
        console.log("  ✅ Signature from wrong key correctly rejected!");
    }, 30000);
    
    test("should verify PGP signature with mixed-case address (backward compatibility)", async () => {
        console.log("🧪 Testing PGP signature with mixed-case address");
        console.log("  This tests backward compatibility for keys registered before address normalization");
        
        // Generate a test PGP key pair
        const { privateKey: privateKeyArmored, publicKey: publicKeyArmored } = await openpgp.generateKey({
            type: 'rsa',
            rsaBits: 2048,
            userIDs: [{ name: 'Test User', email: 'test@example.com' }],
            passphrase: 'test-passphrase',
            format: 'armored'
        });
        
        // Use a mixed-case address (as it was before normalization)
        const mixedCaseAddress = "0x84Fa6d4087B267e2D1B158Ffa277338Da725746b";
        const nonceHex = "0000019a71c719f4b67c110f0938cb771204117b7120a7a3bf2c54f426f45550";
        
        // Manually create the signing message with mixed-case (simulating old behavior)
        const oldStyleMessage = `${mixedCaseAddress} ${nonceHex}`;
        console.log(`  Old-style signing message: ${oldStyleMessage}`);
        
        // Generate signature with the mixed-case message
        const signatureHex = await generatePGPSignature(privateKeyArmored, oldStyleMessage, 'test-passphrase');
        console.log(`  ✅ Signature generated with mixed-case address`);
        
        // Create a mock GitKeyClaim
        const gitKeyClaim = {
            keyType: KeyType.PGPv4,
            nonceHash: ('0x' + nonceHex) as `0x${string}`,
            sig: ('0x' + signatureHex) as `0x${string}`,
            publicKey: publicKeyArmored
        };
        
        // Verify with lowercase address (current behavior)
        const lowercaseAddress = mixedCaseAddress.toLowerCase();
        console.log(`  Verifying with lowercase address: ${lowercaseAddress}`);
        const isValid = await verifyGitKeyClaimSignature(gitKeyClaim, lowercaseAddress);
        
        expect(isValid).toBe(true);
        console.log("  ✅ Mixed-case signature verified with lowercase address (backward compatible)!");
    }, 30000);
});
