import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { importGPGKeyToServer, isGPGKeyImported } from "../src/utils/keyUtils";

// Test environment setup
const testEnvDir = path.join(os.tmpdir(), "git-deal-test-env-pgp");
const testGPGDir = path.join(testEnvDir, ".gnupg");

// Set environment variables for test
process.env.GNUPGHOME = testGPGDir;

// Load test configuration from .env file
async function loadTestConfig() {
  const envFile = Bun.file("./testVerify.env");
  const envContent = await envFile.text();
  
  const config: any = {};
  const lines = envContent.split('\n');
  
  for (const line of lines) {
    if (line.trim() && !line.startsWith('#')) {
      const [key, ...valueParts] = line.split('=');
      if (key) {
        const value = valueParts.join('=').trim();
        
        // Remove surrounding quotes if present
        const cleanValue = value.replace(/^["']|["']$/g, '');
        config[key.trim()] = cleanValue;
      }
    }
  }
  
  return config;
}

const testConfig = await loadTestConfig();

describe("PGP Key Management Tests", () => {
  beforeAll(async () => {
    // Ensure test environment directory exists
    await fs.mkdir(testEnvDir, { recursive: true });
    await fs.mkdir(testGPGDir, { recursive: true });
  });

  afterAll(async () => {
    // Clean up test environment
    if (testConfig.SERVER_CLEANUP_AFTER_TEST) {
      try {
        await fs.rm(testEnvDir, { recursive: true, force: true });
      } catch (error) {
        console.warn("Failed to cleanup test environment:", error);
      }
    }
  });

  beforeEach(async () => {
    // Ensure fresh GPG keyring for each test
    try {
      await fs.rm(testGPGDir, { recursive: true, force: true });
      await fs.mkdir(testGPGDir, { recursive: true });
    } catch (error) {
      console.warn("Failed to reset GPG keyring:", error);
    }
  });

  describe("PGP Key Import Functionality", () => {
    test("should successfully import a valid PGP key", async () => {
      const publicKey = testConfig.PGP_VALID_PUBLIC_KEY;
      const ethereumAddress = testConfig.PGP_VALID_ETHEREUM_ADDRESS;
      const fingerprint = testConfig.PGP_VALID_FINGERPRINT;
      
      // Skip test if no real PGP key is provided
      if (!publicKey || publicKey.includes('REPLACE_WITH_REAL')) {
        console.log('⏭️ Skipping PGP import test - no real PGP key provided in testVerify.env');
        return;
      }
      
      // Import the key
      const importResult = await importGPGKeyToServer(publicKey, ethereumAddress);
      expect(importResult).toBe(true);
      
      // Verify the key is imported and detectable
      const isImported = await isGPGKeyImported(fingerprint);
      expect(isImported).toBe(true);
    });

    test("should handle expired PGP key gracefully", async () => {
      const publicKey = testConfig.PGP_EXPIRED_PUBLIC_KEY;
      const ethereumAddress = testConfig.PGP_EXPIRED_ETHEREUM_ADDRESS;
      const fingerprint = testConfig.PGP_EXPIRED_FINGERPRINT;
      
      // Skip test if no expired PGP key is provided
      if (!publicKey || publicKey.includes('REPLACE_WITH_REAL')) {
        console.log('⏭️ Skipping expired PGP key test - no expired PGP key provided in testVerify.env');
        return;
      }
      
      // Import should still work for expired keys (they can be imported, just not trusted for new signatures)
      const importResult = await importGPGKeyToServer(publicKey, ethereumAddress);
      expect(importResult).toBe(true);
      
      // Verify the key is imported
      const isImported = await isGPGKeyImported(fingerprint);
      expect(isImported).toBe(true);
    });

    test("should reject invalid PGP key", async () => {
      const publicKey = testConfig.PGP_INVALID_PUBLIC_KEY;
      const ethereumAddress = testConfig.PGP_INVALID_ETHEREUM_ADDRESS;
      
      // Skip test if no invalid PGP key is provided
      if (!publicKey || publicKey.includes('REPLACE_WITH_REAL')) {
        console.log('⏭️ Skipping invalid PGP key test - no invalid PGP key provided in testVerify.env');
        return;
      }
      
      // Import should fail for invalid key
      const importResult = await importGPGKeyToServer(publicKey, ethereumAddress);
      expect(importResult).toBe(false);
    });

    test("should handle empty or malformed key", async () => {
      const ethereumAddress = testConfig.PGP_VALID_ETHEREUM_ADDRESS || "0x1234567890123456789012345678901234567890";
      
      // Test with empty key
      const importResult1 = await importGPGKeyToServer("", ethereumAddress);
      expect(importResult1).toBe(false);
      
      // Test with malformed key
      const malformedKey = "-----BEGIN PGP PUBLIC KEY BLOCK-----\nmalformed\n-----END PGP PUBLIC KEY BLOCK-----";
      const importResult2 = await importGPGKeyToServer(malformedKey, ethereumAddress);
      expect(importResult2).toBe(false);
    });
  });

  describe("PGP Key Detection Functionality", () => {
    test("should detect imported PGP key by fingerprint", async () => {
      const publicKey = testConfig.PGP_VALID_PUBLIC_KEY;
      const ethereumAddress = testConfig.PGP_VALID_ETHEREUM_ADDRESS;
      const fingerprint = testConfig.PGP_VALID_FINGERPRINT;
      
      // Skip test if no real PGP key is provided
      if (!publicKey || publicKey.includes('REPLACE_WITH_REAL')) {
        console.log('⏭️ Skipping PGP fingerprint detection test - no real PGP key provided in testVerify.env');
        return;
      }
      
      // Initially not imported
      const isImported1 = await isGPGKeyImported(fingerprint);
      expect(isImported1).toBe(false);
      
      // Import the key
      await importGPGKeyToServer(publicKey, ethereumAddress);
      
      // Now should be detected as imported
      const isImported2 = await isGPGKeyImported(fingerprint);
      expect(isImported2).toBe(true);
    });

    test("should detect imported PGP key by key ID", async () => {
      const publicKey = testConfig.PGP_VALID_PUBLIC_KEY;
      const ethereumAddress = testConfig.PGP_VALID_ETHEREUM_ADDRESS;
      const keyId = testConfig.PGP_VALID_KEY_ID;
      
      // Skip test if no real PGP key is provided
      if (!publicKey || publicKey.includes('REPLACE_WITH_REAL')) {
        console.log('⏭️ Skipping PGP key ID detection test - no real PGP key provided in testVerify.env');
        return;
      }
      
      // Import the key
      await importGPGKeyToServer(publicKey, ethereumAddress);
      
      // Should be detectable by key ID
      const isImported = await isGPGKeyImported(keyId);
      expect(isImported).toBe(true);
    });

    test("should return false for non-existent PGP key", async () => {
      const nonExistentFingerprint = "9999999999999999999999999999999999999999";
      
      const isImported = await isGPGKeyImported(nonExistentFingerprint);
      expect(isImported).toBe(false);
    });

    test("should handle missing GPG keyring gracefully", async () => {
      // Ensure no keyring exists
      await fs.rm(testGPGDir, { recursive: true, force: true });
      
      const isImported = await isGPGKeyImported("1234567890ABCDEF");
      expect(isImported).toBe(false);
    });
  });

  describe("PGP Key Removal Functionality", () => {
    test("should remove all imported PGP keys during cleanup", async () => {
      const publicKey = testConfig.PGP_VALID_PUBLIC_KEY;
      const ethereumAddress = testConfig.PGP_VALID_ETHEREUM_ADDRESS;
      const fingerprint = testConfig.PGP_VALID_FINGERPRINT;
      
      // Skip test if no real PGP key is provided
      if (!publicKey || publicKey.includes('REPLACE_WITH_REAL')) {
        console.log('⏭️ Skipping PGP key removal test - no real PGP key provided in testVerify.env');
        return;
      }
      
      // Import the key
      await importGPGKeyToServer(publicKey, ethereumAddress);
      
      // Verify it's imported
      const isImportedBefore = await isGPGKeyImported(fingerprint);
      expect(isImportedBefore).toBe(true);
      
      // Clean up (remove) by removing the GPG directory
      await fs.rm(testGPGDir, { recursive: true, force: true });
      
      // Should no longer be imported
      const isImportedAfter = await isGPGKeyImported(fingerprint);
      expect(isImportedAfter).toBe(false);
    });

    test("should handle removal when no keys exist", async () => {
      // Ensure clean state
      await fs.rm(testGPGDir, { recursive: true, force: true });
      
      // Try to clean up again - should not throw
      await expect(fs.rm(testGPGDir, { recursive: true, force: true })).resolves.not.toThrow();
    });

    test("should recreate keyring directory after removal", async () => {
      // Remove entire keyring directory
      await fs.rm(testGPGDir, { recursive: true, force: true });
      
      // Import a key (should recreate directory)
      const publicKey = testConfig.PGP_VALID_PUBLIC_KEY;
      const ethereumAddress = testConfig.PGP_VALID_ETHEREUM_ADDRESS;
      
      // Skip test if no real PGP key is provided
      if (!publicKey || publicKey.includes('REPLACE_WITH_REAL')) {
        console.log('⏭️ Skipping PGP keyring recreation test - no real PGP key provided in testVerify.env');
        return;
      }
      
      await importGPGKeyToServer(publicKey, ethereumAddress);
      
      // Verify directory exists
      const dirExists = await fs.access(testGPGDir).then(() => true).catch(() => false);
      expect(dirExists).toBe(true);
    });
  });

  describe("PGP Edge Cases and Error Handling", () => {
    test("should handle empty GPG home directory", async () => {
      // Ensure empty GPG directory
      await fs.rm(testGPGDir, { recursive: true, force: true });
      await fs.mkdir(testGPGDir, { recursive: true });
      
      const publicKey = testConfig.PGP_VALID_PUBLIC_KEY;
      const ethereumAddress = testConfig.PGP_VALID_ETHEREUM_ADDRESS;
      
      // Skip test if no real PGP key is provided
      if (!publicKey || publicKey.includes('REPLACE_WITH_REAL')) {
        console.log('⏭️ Skipping empty GPG directory test - no real PGP key provided in testVerify.env');
        return;
      }
      
      // Should be able to import without errors
      const result = await importGPGKeyToServer(publicKey, ethereumAddress);
      expect(result).toBeDefined();
    });

    test("should handle corrupted GPG home directory", async () => {
      // Create a corrupted state by creating a file where directory should be
      await fs.rm(testGPGDir, { recursive: true, force: true });
      await fs.writeFile(testGPGDir, "corrupted");
      
      const publicKey = testConfig.PGP_VALID_PUBLIC_KEY;
      const ethereumAddress = testConfig.PGP_VALID_ETHEREUM_ADDRESS;
      
      // Skip test if no real PGP key is provided
      if (!publicKey || publicKey.includes('REPLACE_WITH_REAL')) {
        console.log('⏭️ Skipping corrupted GPG directory test - no real PGP key provided in testVerify.env');
        return;
      }
      
      // Should handle error gracefully
      await expect(importGPGKeyToServer(publicKey, ethereumAddress)).rejects.toThrow();
    });

    test("should handle permissions issues", async () => {
      // Skip on Windows or if not root
      if (process.platform === "win32" || process.getuid?.() === 0) {
        console.log("⏭️ Skipping permissions test on Windows or as root");
        return;
      }
      
      const publicKey = testConfig.PGP_VALID_PUBLIC_KEY;
      const ethereumAddress = testConfig.PGP_VALID_ETHEREUM_ADDRESS;
      
      // Skip test if no real PGP key is provided
      if (!publicKey || publicKey.includes('REPLACE_WITH_REAL')) {
        console.log('⏭️ Skipping permissions test - no real PGP key provided in testVerify.env');
        return;
      }
      
      try {
        // Make GPG directory read-only
        await fs.chmod(testGPGDir, 0o444);
        
        // Should handle permissions error
        await expect(importGPGKeyToServer(publicKey, ethereumAddress)).rejects.toThrow();
      } finally {
        // Restore permissions for cleanup
        try {
          await fs.chmod(testGPGDir, 0o755);
        } catch {}
      }
    });

    test("should handle malformed PGP key gracefully", async () => {
      const malformedKey = "-----BEGIN PGP PUBLIC KEY BLOCK-----\nmalformed\n-----END PGP PUBLIC KEY BLOCK-----";
      const ethereumAddress = testConfig.PGP_VALID_ETHEREUM_ADDRESS || "0x1234567890123456789012345678901234567890";
      
      // Should handle malformed key error
      await expect(importGPGKeyToServer(malformedKey, ethereumAddress)).rejects.toThrow();
    });

    test("should handle invalid fingerprint format", async () => {
      const invalidFingerprint = "invalid-fingerprint-format";
      
      const isImported = await isGPGKeyImported(invalidFingerprint);
      expect(isImported).toBe(false);
    });

    test("should handle very large key files", async () => {
      // Create a very large fake key (but still valid format)
      const largeKeyContent = "X".repeat(100000); // 100KB of X's
      const largeKey = `-----BEGIN PGP PUBLIC KEY BLOCK-----\n${largeKeyContent}\n-----END PGP PUBLIC KEY BLOCK-----`;
      const ethereumAddress = testConfig.PGP_VALID_ETHEREUM_ADDRESS || "0x1234567890123456789012345678901234567890";
      
      // Should handle large key appropriately (either import or reject gracefully)
      await expect(importGPGKeyToServer(largeKey, ethereumAddress)).rejects.toThrow();
    });
  });

  describe("Multiple PGP Keys Management", () => {
    test("should handle multiple PGP keys from different addresses", async () => {
      const publicKey1 = testConfig.PGP_VALID_PUBLIC_KEY;
      const ethereumAddress1 = testConfig.PGP_VALID_ETHEREUM_ADDRESS;
      const fingerprint1 = testConfig.PGP_VALID_FINGERPRINT;
      
      const publicKey2 = testConfig.PGP_EXPIRED_PUBLIC_KEY;
      const ethereumAddress2 = testConfig.PGP_EXPIRED_ETHEREUM_ADDRESS;
      const fingerprint2 = testConfig.PGP_EXPIRED_FINGERPRINT;
      
      // Skip test if no real PGP keys are provided
      if (!publicKey1 || publicKey1.includes('REPLACE_WITH_REAL') || 
          !publicKey2 || publicKey2.includes('REPLACE_WITH_REAL')) {
        console.log('⏭️ Skipping multiple PGP keys test - need real PGP keys in testVerify.env');
        return;
      }
      
      // Import both keys
      await importGPGKeyToServer(publicKey1, ethereumAddress1);
      await importGPGKeyToServer(publicKey2, ethereumAddress2);
      
      // Both should be imported
      expect(await isGPGKeyImported(fingerprint1)).toBe(true);
      expect(await isGPGKeyImported(fingerprint2)).toBe(true);
    });
  });

  describe("PGP Key Validation", () => {
    test("should validate PGP key format during import", async () => {
      const publicKey = testConfig.PGP_VALID_PUBLIC_KEY;
      
      // Skip test if no real PGP key is provided
      if (!publicKey || publicKey.includes('REPLACE_WITH_REAL')) {
        console.log('⏭️ Skipping PGP validation test - no real PGP key provided in testVerify.env');
        return;
      }
      
      // Verify the key has proper PGP armor format
      expect(publicKey).toContain('-----BEGIN PGP PUBLIC KEY BLOCK-----');
      expect(publicKey).toContain('-----END PGP PUBLIC KEY BLOCK-----');
      
      // Import should succeed for properly formatted key
      const importResult = await importGPGKeyToServer(publicKey, "0x1234567890123456789012345678901234567890");
      expect(importResult).toBe(true);
    });

    test("should reject malformed PGP key", async () => {
      const malformedKey = "-----BEGIN INVALID KEY-----\nNot a real PGP key\n-----END INVALID KEY-----";
      
      const importResult = await importGPGKeyToServer(malformedKey, "0x1234567890123456789012345678901234567890");
      expect(importResult).toBe(false);
    });
  });

  describe("Concurrent PGP Operations", () => {
    test("should handle concurrent key imports safely", async () => {
      const publicKey1 = testConfig.PGP_VALID_PUBLIC_KEY;
      const ethereumAddress1 = testConfig.PGP_VALID_ETHEREUM_ADDRESS;
      const fingerprint1 = testConfig.PGP_VALID_FINGERPRINT;
      
      const publicKey2 = testConfig.PGP_EXPIRED_PUBLIC_KEY;
      const ethereumAddress2 = testConfig.PGP_EXPIRED_ETHEREUM_ADDRESS;
      const fingerprint2 = testConfig.PGP_EXPIRED_FINGERPRINT;
      
      // Skip test if no real PGP keys are provided
      if (!publicKey1 || publicKey1.includes('REPLACE_WITH_REAL') || 
          !publicKey2 || publicKey2.includes('REPLACE_WITH_REAL')) {
        console.log('⏭️ Skipping concurrent PGP operations test - need real PGP keys in testVerify.env');
        return;
      }
      
      // Import keys concurrently
      const [result1, result2] = await Promise.all([
        importGPGKeyToServer(publicKey1, ethereumAddress1),
        importGPGKeyToServer(publicKey2, ethereumAddress2)
      ]);
      
      // Both operations should complete successfully
      expect(result1).toBe(true);
      expect(result2).toBe(true);
      
      // Both keys should be imported
      expect(await isGPGKeyImported(fingerprint1.replace(/\s/g, ''))).toBe(true);
      expect(await isGPGKeyImported(fingerprint2.replace(/\s/g, ''))).toBe(true);
    });
  });
});