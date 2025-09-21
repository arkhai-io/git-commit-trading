import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "child_process";
import path from "path";
import { tmpdir } from "os";
import { promises as fs } from "fs";
import { existsSync } from "fs";
import {
  importSSHKeyToServer,
  isSSHKeyImported,
  removeSSHKeyFromServer,
  initializeServerGitEnvironment
} from "../src/utils/keyUtils.js";
import { GitVerificationService } from "../src/services/verificationService.js";

// Load test configuration from .env file
async function loadTestConfig() {
  const envFile = Bun.file("./testVerify.env");
  const envContent = await envFile.text();
  
  const config: any = {};
  const lines = envContent.split('\n');
  
  for (const line of lines) {
    if (line.trim() && !line.startsWith('#')) {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        let value: any = valueParts.join('=').trim();
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        // Handle boolean values
        if (value === 'true') value = true;
        if (value === 'false') value = false;
        // Handle numeric values
        if (!isNaN(Number(value)) && value !== '') value = Number(value);
        
        config[key] = value;
      }
    }
  }
  
  return config;
}

const testConfig = await loadTestConfig();

describe("SSH Key Verification Tests", () => {
  let testEnvDir: string;
  let testSSHDir: string;
  let verificationService: GitVerificationService;
  let originalHome: string | undefined;

  beforeAll(async () => {
    // Save original HOME
    originalHome = process.env.HOME;
    
    // Create test directory structure
    testEnvDir = path.join(tmpdir(), `ssh-verify-test-${Date.now()}`);
    testSSHDir = path.join(testEnvDir, '.ssh');
    
    await fs.mkdir(testSSHDir, { recursive: true, mode: 0o700 });
    
    // Set HOME to test directory for isolated testing
    process.env.HOME = testEnvDir;
    
    // Initialize server git environment
    await initializeServerGitEnvironment();
    
    // Initialize verification service
    verificationService = new GitVerificationService({
      timeoutMs: testConfig.SERVER_TIMEOUT_MS,
      cleanupAfterVerification: testConfig.SERVER_CLEANUP_AFTER_TEST,
      enableSSH: testConfig.SERVER_ENABLE_SSH,
      enableGPG: false, // Disable GPG for SSH-only tests
      autoImportKeys: testConfig.SERVER_AUTO_IMPORT_KEYS
    });
    
    await verificationService.initialize();
  });

  beforeEach(async () => {
    // Clean up any existing test keys before each test
    const allowedSignersPath = path.join(testSSHDir, 'allowed_signers');
    try {
      await fs.unlink(allowedSignersPath);
    } catch (error) {
      // File doesn't exist, which is fine
    }
  });

  afterAll(async () => {
    // Restore original HOME
    if (originalHome) {
      process.env.HOME = originalHome;
    }
    
    // Clean up test directory
    if (testConfig.SERVER_CLEANUP_AFTER_TEST) {
      try {
        await fs.rm(testEnvDir, { recursive: true, force: true });
      } catch (error) {
        console.warn("Failed to cleanup test directory:", error);
      }
    }
  });

  describe("SSH Key Import Functionality", () => {
    test("should successfully import valid SSH Ed25519 key", async () => {
      const publicKey = testConfig.SSH_VALID_ED25519_PUBLIC_KEY;
      const ethereumAddress = testConfig.SSH_VALID_ED25519_ETHEREUM_ADDRESS;
      
      // Import the SSH key
      const importResult = await importSSHKeyToServer(publicKey, ethereumAddress);
      
      // Verify import was successful
      expect(importResult).toBe(true);
      
      // Check if key is now imported
      const isImported = await isSSHKeyImported(ethereumAddress);
      expect(isImported).toBe(true);
      
      // Verify allowed_signers file content
      const allowedSignersPath = path.join(testSSHDir, 'allowed_signers');
      expect(existsSync(allowedSignersPath)).toBe(true);
      
      const content = await fs.readFile(allowedSignersPath, 'utf-8');
      expect(content).toContain(ethereumAddress);
      expect(content).toContain(publicKey.trim());
    });

    test("should successfully import valid SSH RSA key", async () => {
      const publicKey = testConfig.SSH_VALID_RSA_PUBLIC_KEY;
      const ethereumAddress = testConfig.SSH_VALID_RSA_ETHEREUM_ADDRESS;
      
      // Import the SSH RSA key
      const importResult = await importSSHKeyToServer(publicKey, ethereumAddress);
      
      // Verify import was successful
      expect(importResult).toBe(true);
      
      // Check if key is now imported
      const isImported = await isSSHKeyImported(ethereumAddress);
      expect(isImported).toBe(true);
    });

    test("should handle invalid SSH key gracefully", async () => {
      const publicKey = testConfig.SSH_INVALID_PUBLIC_KEY;
      const ethereumAddress = testConfig.SSH_INVALID_ETHEREUM_ADDRESS;
      
      // Attempt to import invalid SSH key
      const importResult = await importSSHKeyToServer(publicKey, ethereumAddress);
      
      // Import should still succeed but key format may be normalized
      expect(importResult).toBe(true);
      
      // Check allowed_signers file was created
      const allowedSignersPath = path.join(testSSHDir, 'allowed_signers');
      expect(existsSync(allowedSignersPath)).toBe(true);
    });

    test("should detect already imported SSH keys", async () => {
      const publicKey = testConfig.SSH_VALID_ED25519_PUBLIC_KEY;
      const ethereumAddress = testConfig.SSH_VALID_ED25519_ETHEREUM_ADDRESS;
      
      // Import key first time
      await importSSHKeyToServer(publicKey, ethereumAddress);
      
      // Verify it's imported
      const isImported1 = await isSSHKeyImported(ethereumAddress);
      expect(isImported1).toBe(true);
      
      // Import same key again
      const importResult2 = await importSSHKeyToServer(publicKey, ethereumAddress);
      expect(importResult2).toBe(true);
      
      // Should still be imported
      const isImported2 = await isSSHKeyImported(ethereumAddress);
      expect(isImported2).toBe(true);
      
      // Check that file doesn't have duplicate entries
      const allowedSignersPath = path.join(testSSHDir, 'allowed_signers');
      const content = await fs.readFile(allowedSignersPath, 'utf-8');
      const lines = content.split('\\n').filter(line => line.includes(ethereumAddress));
      expect(lines.length).toBeLessThanOrEqual(1);
    });
  });

  describe("SSH Key Detection Functionality", () => {
    test("should detect imported SSH key by ethereum address", async () => {
      const publicKey = testConfig.SSH_VALID_ED25519_PUBLIC_KEY;
      const ethereumAddress = testConfig.SSH_VALID_ED25519_ETHEREUM_ADDRESS;
      
      // Initially not imported
      const isImported1 = await isSSHKeyImported(ethereumAddress);
      expect(isImported1).toBe(false);
      
      // Import the key
      await importSSHKeyToServer(publicKey, ethereumAddress);
      
      // Now should be detected as imported
      const isImported2 = await isSSHKeyImported(ethereumAddress);
      expect(isImported2).toBe(true);
    });

    test("should return false for non-existent SSH key", async () => {
      const nonExistentAddress = "0x9999999999999999999999999999999999999999";
      
      const isImported = await isSSHKeyImported(nonExistentAddress);
      expect(isImported).toBe(false);
    });

    test("should handle missing allowed_signers file gracefully", async () => {
      // Ensure no allowed_signers file exists
      const allowedSignersPath = path.join(testSSHDir, 'allowed_signers');
      try {
        await fs.unlink(allowedSignersPath);
      } catch (error) {
        // File doesn't exist, which is what we want
      }
      
      const isImported = await isSSHKeyImported("0x1234567890123456789012345678901234567890");
      expect(isImported).toBe(false);
    });
  });

  describe("SSH Key Removal Functionality", () => {
    test("should successfully remove SSH key from server", async () => {
      const publicKey = testConfig.SSH_VALID_ED25519_PUBLIC_KEY;
      const ethereumAddress = testConfig.SSH_VALID_ED25519_ETHEREUM_ADDRESS;
      
      // Import key first
      await importSSHKeyToServer(publicKey, ethereumAddress);
      expect(await isSSHKeyImported(ethereumAddress)).toBe(true);
      
      // Remove the key
      const removeResult = await removeSSHKeyFromServer(ethereumAddress);
      expect(removeResult).toBe(true);
      
      // Verify key is no longer imported
      const isImported = await isSSHKeyImported(ethereumAddress);
      expect(isImported).toBe(false);
    });

    test("should handle removal of non-existent key gracefully", async () => {
      const nonExistentAddress = "0x8888888888888888888888888888888888888888";
      
      // Remove non-existent key
      const removeResult = await removeSSHKeyFromServer(nonExistentAddress);
      expect(removeResult).toBe(true);
    });
  });

  describe("SSH Key File Permissions", () => {
    test("should set correct permissions on allowed_signers file", async () => {
      const publicKey = testConfig.SSH_VALID_ED25519_PUBLIC_KEY;
      const ethereumAddress = testConfig.SSH_VALID_ED25519_ETHEREUM_ADDRESS;
      
      // Import key
      await importSSHKeyToServer(publicKey, ethereumAddress);
      
      // Check file permissions
      const allowedSignersPath = path.join(testSSHDir, 'allowed_signers');
      const stats = await fs.stat(allowedSignersPath);
      
      // Should be readable/writable by owner only (600)
      const permissions = stats.mode & parseInt('777', 8);
      expect(permissions).toBe(parseInt('600', 8));
    });
  });

  describe("Multiple SSH Keys Management", () => {
    test("should handle multiple SSH keys from different addresses", async () => {
      const key1 = {
        publicKey: testConfig.SSH_VALID_ED25519_PUBLIC_KEY,
        ethereumAddress: testConfig.SSH_VALID_ED25519_ETHEREUM_ADDRESS
      };
      const key2 = {
        publicKey: testConfig.SSH_VALID_RSA_PUBLIC_KEY,
        ethereumAddress: testConfig.SSH_VALID_RSA_ETHEREUM_ADDRESS
      };
      
      // Import both keys
      await importSSHKeyToServer(key1.publicKey, key1.ethereumAddress);
      await importSSHKeyToServer(key2.publicKey, key2.ethereumAddress);
      
      // Both should be imported
      expect(await isSSHKeyImported(key1.ethereumAddress)).toBe(true);
      expect(await isSSHKeyImported(key2.ethereumAddress)).toBe(true);
      
      // Check file content has both keys
      const allowedSignersPath = path.join(testSSHDir, 'allowed_signers');
      const content = await fs.readFile(allowedSignersPath, 'utf-8');
      expect(content).toContain(key1.ethereumAddress);
      expect(content).toContain(key2.ethereumAddress);
      
      // Remove one key
      await removeSSHKeyFromServer(key1.ethereumAddress);
      
      // First should be removed, second should remain
      expect(await isSSHKeyImported(key1.ethereumAddress)).toBe(false);
      expect(await isSSHKeyImported(key2.ethereumAddress)).toBe(true);
    });
  });

  describe("SSH Key Format Normalization", () => {
    test("should normalize SSH key format during import", async () => {
      const ethereumAddress = testConfig.SSH_VALID_ED25519_ETHEREUM_ADDRESS;
      
      // Test with key material only (no ssh-ed25519 prefix)
      const keyMaterialOnly = "AAAAC3NzaC1lZDI1NTE5AAAAIGrTzJn2l8vF9HJ3q5J5K4Y7X8Z9A1B2C3D4E5F6G7H8I9J0";
      
      const importResult = await importSSHKeyToServer(keyMaterialOnly, ethereumAddress);
      expect(importResult).toBe(true);
      
      // Check that the key was properly normalized in allowed_signers
      const allowedSignersPath = path.join(testSSHDir, 'allowed_signers');
      const content = await fs.readFile(allowedSignersPath, 'utf-8');
      expect(content).toContain('ssh-ed25519');
      expect(content).toContain(keyMaterialOnly);
    });
  });

  describe("Error Handling and Edge Cases", () => {
    test("should handle filesystem errors gracefully", async () => {
      // Create a directory where the file should be (to simulate permission error)
      const allowedSignersPath = path.join(testSSHDir, 'allowed_signers');
      await fs.mkdir(allowedSignersPath, { recursive: true });
      
      const publicKey = testConfig.SSH_VALID_ED25519_PUBLIC_KEY;
      const ethereumAddress = testConfig.SSH_VALID_ED25519_ETHEREUM_ADDRESS;
      
      // This should fail but not throw
      const importResult = await importSSHKeyToServer(publicKey, ethereumAddress);
      expect(importResult).toBe(false);
      
      // Clean up the directory
      await fs.rm(allowedSignersPath, { recursive: true, force: true });
    });

    test("should handle empty or whitespace-only keys", async () => {
      const ethereumAddress = "0x7777777777777777777777777777777777777777";
      
      // Test with empty key
      const importResult1 = await importSSHKeyToServer("", ethereumAddress);
      expect(importResult1).toBe(true); // Function is lenient
      
      // Test with whitespace-only key
      const importResult2 = await importSSHKeyToServer("   \\n\\t  ", ethereumAddress + "1");
      expect(importResult2).toBe(true); // Function is lenient
    });
  });
});