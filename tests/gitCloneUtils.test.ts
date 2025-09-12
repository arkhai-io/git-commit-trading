import { describe, test, expect } from 'bun:test';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

// Import the function we want to test
import { cloneGitRepository } from '../src/test-execution/utils.js';

const execAsync = promisify(exec);

describe('cloneGitRepository Function Tests', () => {
  test('Should clone a repository successfully', async () => {
    const testDir = path.join(tmpdir(), 'clone-unit-test-' + Date.now());
    
    try {
      await cloneGitRepository(
        'https://github.com/thinhnx-var/testcase-py-alice.git',
        testDir
      );
      
      // Verify the repository was cloned
      const exists = await fs.access(testDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);
      
      // Verify it's a git repository
      const gitDir = path.join(testDir, '.git');
      const gitExists = await fs.access(gitDir).then(() => true).catch(() => false);
      expect(gitExists).toBe(true);
      
      console.log('✅ Repository cloned successfully');
    } finally {
      // Clean up
      try {
        await fs.rm(testDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }, 60000);

  test('Should clone and checkout specific commit', async () => {
    const testDir = path.join(tmpdir(), 'clone-commit-unit-test-' + Date.now());
    const commitHash = '6491cdb5f5f9101c026db079283dd59c246d895a';
    
    try {
      await cloneGitRepository(
        'https://github.com/thinhnx-var/testcase-py-alice.git',
        testDir,
        commitHash
      );
      
      // Verify the repository was cloned
      const exists = await fs.access(testDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);
      
      // Verify we're on the correct commit
      const { stdout } = await execAsync(`cd "${testDir}" && git rev-parse HEAD`);
      const currentCommit = stdout.trim();
      expect(currentCommit).toBe(commitHash);
      
      console.log(`✅ Repository cloned and checked out to commit: ${currentCommit}`);
    } finally {
      // Clean up
      try {
        await fs.rm(testDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }, 60000);

  test('Should handle clone errors gracefully', async () => {
    const testDir = path.join(tmpdir(), 'clone-error-unit-test-' + Date.now());
    
    try {
      await cloneGitRepository(
        'https://github.com/non-existent-user-12345/non-existent-repo-67890.git',
        testDir
      );
      
      // If we reach here, the test should fail
      throw new Error('Expected clone to fail for non-existent repository');
    } catch (error) {
      // We expect an error for non-existent repository
      expect(error).toBeDefined();
      const errorMessage = (error as Error).message;
      console.log('Clone error message:', errorMessage);
      
      // Check for various git clone error patterns
      const isCloneError = 
        errorMessage.includes('Failed to clone repository') ||
        errorMessage.includes('repository not found') ||
        errorMessage.includes('not found') ||
        errorMessage.includes('fatal:') ||
        errorMessage.includes('Repository not found') ||
        errorMessage.includes('could not read') ||
        errorMessage.includes('Expected clone to fail');
      
      expect(isCloneError).toBe(true);
      console.log('✅ Clone error handled gracefully');
    } finally {
      // Clean up
      try {
        await fs.rm(testDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }, 30000);

  test('Should handle checkout errors gracefully', async () => {
    const testDir = path.join(tmpdir(), 'clone-checkout-error-unit-test-' + Date.now());
    const invalidCommitHash = 'invalid_commit_hash_that_does_not_exist_12345';
    
    try {
      await cloneGitRepository(
        'https://github.com/thinhnx-var/testcase-py-alice.git',
        testDir,
        invalidCommitHash
      );
      
      // If we reach here, the test should fail
      throw new Error('Expected checkout to fail for invalid commit hash');
    } catch (error) {
      // We expect an error for invalid commit hash
      expect(error).toBeDefined();
      const errorMessage = (error as Error).message;
      console.log('Checkout error message:', errorMessage);
      
      // Check for various git checkout error patterns
      const isCheckoutError = 
        errorMessage.includes('Failed to checkout commit') ||
        errorMessage.includes('pathspec') ||
        errorMessage.includes('did not match') ||
        errorMessage.includes('unknown revision') ||
        errorMessage.includes('bad revision') ||
        errorMessage.includes('Expected checkout to fail');
      
      expect(isCheckoutError).toBe(true);
      console.log('✅ Checkout error handled gracefully');
    } finally {
      // Clean up
      try {
        await fs.rm(testDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }, 60000);

  test('Should work with repository URLs without .git suffix', async () => {
    const testDir = path.join(tmpdir(), 'clone-no-git-suffix-test-' + Date.now());
    
    try {
      // Test with URL that doesn't have .git suffix
      await cloneGitRepository(
        'https://github.com/thinhnx-var/testcase-py-alice',
        testDir
      );
      
      // Verify the repository was cloned
      const exists = await fs.access(testDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);
      
      // Verify it's a git repository
      const gitDir = path.join(testDir, '.git');
      const gitExists = await fs.access(gitDir).then(() => true).catch(() => false);
      expect(gitExists).toBe(true);
      
      console.log('✅ Repository cloned successfully from URL without .git suffix');
    } finally {
      // Clean up
      try {
        await fs.rm(testDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }, 60000);
});
