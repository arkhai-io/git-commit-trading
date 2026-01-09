import { describe, test, expect } from 'bun:test';
import { executeTests } from '../src/test-execution/index.js';
import path from 'path';
import { tmpdir } from 'os';

describe('Git Clone Tests', () => {
  test('Should clone GitHub repository with .git suffix', async () => {
    console.log('Testing git clone with .git URLs...');
    const result = await executeTests({
      tests: {
        hosts: ['https://github.com/thinhnx-var/testcase-repo-alice.git'],
        commit: 'ab940eceae6702e05b9c03765b7407a054ea84c9'
      },
      source: {
        hosts: ['https://github.com/thinhnx-var/solution-repo-bob.git'],
        commit: '14acbbd4b4795dc5a8178540e32e1aa9661867ea'
      },
      timeout: 300000,
      cleanup: true
    });

    expect(result.success).toBe(true);
    console.log('Git clone test completed successfully!');
  }, 120000);

  test('Should handle git URLs without .git suffix', async () => {
    console.log('Testing git clone with URLs without .git suffix...');
    const result = await executeTests({
      tests: {
        hosts: ['https://github.com/thinhnx-var/testcase-repo-alice'],
        commit: 'ab940eceae6702e05b9c03765b7407a054ea84c9'
      },
      source: {
        hosts: ['https://github.com/thinhnx-var/solution-repo-bob'],
        commit: '14acbbd4b4795dc5a8178540e32e1aa9661867ea'
      },
      timeout: 300000,
      cleanup: true
    });

    expect(result.success).toBe(true);
    console.log('Git clone without .git suffix test completed successfully!');
  }, 120000);

  test('Should handle git clone errors gracefully', async () => {
    console.log('Testing git clone error handling...');

    const result = await executeTests({
      tests: {
        hosts: ['https://github.com/thinhnx-var/testcase-repo-alice.git'],
        commit: 'ab940eceae6702e05b9c03765b7407a054ea84c9'
      },
      source: {
        hosts: ['https://github.com/non-existent-user-12345/non-existent-repo-67890.git'],
        commit: 'abcd1234'
      },
      timeout: 300000,
      cleanup: true
    });

    // The execution should fail because the source repo doesn't exist
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    console.log('Error message received:', result.error);
    console.log('Git clone error handling test passed!');
  }, 60000);
});
