import { describe, test, expect } from 'bun:test';
import { GitTestExecution } from '../src/test-execution/sdk.js';
import path from 'path';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';

describe('Archive Download Tests', () => {
  test('Case 1: GitHub URL with .git suffix should be converted to archive URL', async () => {
    const tempDir = path.join(tmpdir(), 'archive-test-git-' + Date.now());
    
    const config = {
      repositories: {
        source: {
          url: 'https://github.com/thinhnx-var/solution-repo-bob.git',
          commitHash: '14acbbd4b4795dc5a8178540e32e1aa9661867ea',
          testCommand: 'npm test',
          buildCommand: 'npm run build',
          installCommand: 'npm install'
        },
        testcase: {
          url: 'https://github.com/thinhnx-var/testcase-repo-alice.git',
          commitHash: 'ab940eceae6702e05b9c03765b7407a054ea84c9',
          testCommand: 'npm test',
          installCommand: 'npm install'
        }
      },
      execution: {
        timeout: 300000,
        cleanupAfterExecution: true,
        isolatedEnvironment: true,
        tempDirectory: tempDir
      }
    };

    console.log('Testing Case 1: GitHub URLs with .git suffix...');
    const result = await GitTestExecution.executeTests(config);
    
    expect(result.sourceCloned).toBe(true);
    expect(result.testcaseCloned).toBe(true);
    expect(result.testResult.success).toBe(true);
    
    console.log('Case 1 test completed successfully!');
  }, 120000);

  test('Case 2: GitHub URL without .git suffix should create archive URL', async () => {
    const tempDir = path.join(tmpdir(), 'archive-test-no-git-' + Date.now());
    
    const config = {
      repositories: {
        source: {
          url: 'https://github.com/thinhnx-var/solution-repo-bob',
          commitHash: '14acbbd4b4795dc5a8178540e32e1aa9661867ea',
          testCommand: 'npm test',
          buildCommand: 'npm run build',
          installCommand: 'npm install'
        },
        testcase: {
          url: 'https://github.com/thinhnx-var/testcase-repo-alice',
          commitHash: 'ab940eceae6702e05b9c03765b7407a054ea84c9',
          testCommand: 'npm test',
          installCommand: 'npm install'
        }
      },
      execution: {
        timeout: 300000,
        cleanupAfterExecution: true,
        isolatedEnvironment: true,
        tempDirectory: tempDir
      }
    };

    console.log('Testing Case 2: GitHub URLs without .git suffix...');
    const result = await GitTestExecution.executeTests(config);
    
    expect(result.sourceCloned).toBe(true);
    expect(result.testcaseCloned).toBe(true);
    expect(result.testResult.success).toBe(true);
    
    console.log('Case 2 test completed successfully!');
  }, 120000);

  test('Case 3: Direct archive URLs should be downloaded directly', async () => {
    const tempDir = path.join(tmpdir(), 'archive-test-direct-' + Date.now());
    
    const config = {
      repositories: {
        source: {
          url: 'https://github.com/thinhnx-var/solution-repo-bob/archive/14acbbd4b4795dc5a8178540e32e1aa9661867ea.tar.gz',
          commitHash: '14acbbd4b4795dc5a8178540e32e1aa9661867ea',
          testCommand: 'npm test',
          buildCommand: 'npm run build',
          installCommand: 'npm install'
        },
        testcase: {
          url: 'https://github.com/thinhnx-var/testcase-repo-alice/archive/ab940eceae6702e05b9c03765b7407a054ea84c9.tar.gz',
          commitHash: 'ab940eceae6702e05b9c03765b7407a054ea84c9',
          testCommand: 'npm test',
          installCommand: 'npm install'
        }
      },
      execution: {
        timeout: 300000,
        cleanupAfterExecution: true,
        isolatedEnvironment: true,
        tempDirectory: tempDir
      }
    };

    console.log('Testing Case 3: Direct archive URLs...');
    const result = await GitTestExecution.executeTests(config);
    
    expect(result.sourceCloned).toBe(true);
    expect(result.testcaseCloned).toBe(true);
    expect(result.testResult.success).toBe(true);
    
    console.log('Case 3 test completed successfully!');
  }, 120000);

  test('All cases should produce the same result', async () => {
    console.log('Testing that all three cases produce equivalent results...');
    
    const baseConfig = {
      execution: {
        timeout: 300000,
        cleanupAfterExecution: true,
        isolatedEnvironment: true,
        tempDirectory: tmpdir()
      }
    };

    // Test all three URL formats for the same repositories
    const urlVariants = [
      { 
        name: 'Case 1: .git URLs',
        source: 'https://github.com/thinhnx-var/solution-repo-bob.git',
        testcase: 'https://github.com/thinhnx-var/testcase-repo-alice.git'
      },
      { 
        name: 'Case 2: GitHub URLs without .git',
        source: 'https://github.com/thinhnx-var/solution-repo-bob',
        testcase: 'https://github.com/thinhnx-var/testcase-repo-alice'
      },
      { 
        name: 'Case 3: Direct archive URLs',
        source: 'https://github.com/thinhnx-var/solution-repo-bob/archive/14acbbd4b4795dc5a8178540e32e1aa9661867ea.tar.gz',
        testcase: 'https://github.com/thinhnx-var/testcase-repo-alice/archive/ab940eceae6702e05b9c03765b7407a054ea84c9.tar.gz'
      }
    ];

    const results = [];
    
    for (const variant of urlVariants) {
      const tempDir = path.join(tmpdir(), `archive-test-${variant.name.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`);
      
      const config = {
        ...baseConfig,
        repositories: {
          source: {
            url: variant.source,
            commitHash: '14acbbd4b4795dc5a8178540e32e1aa9661867ea',
            testCommand: 'npm test',
            buildCommand: 'npm run build',
            installCommand: 'npm install'
          },
          testcase: {
            url: variant.testcase,
            commitHash: 'ab940eceae6702e05b9c03765b7407a054ea84c9',
            testCommand: 'npm test',
            installCommand: 'npm install'
          }
        },
        execution: {
          ...baseConfig.execution,
          tempDirectory: tempDir
        }
      };

      console.log(`Testing ${variant.name}...`);
      const result = await GitTestExecution.executeTests(config);
      results.push({
        name: variant.name,
        success: result.testResult.success,
        sourceCloned: result.sourceCloned,
        testcaseCloned: result.testcaseCloned
      });
    }

    // All results should be the same
    results.forEach(result => {
      expect(result.success).toBe(true);
      expect(result.sourceCloned).toBe(true);
      expect(result.testcaseCloned).toBe(true);
    });

    console.log('All cases produced equivalent results!');
  }, 300000);
});
