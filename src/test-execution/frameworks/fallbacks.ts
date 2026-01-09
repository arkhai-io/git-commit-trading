import { promises as fs } from 'fs';
import type { Framework } from '../types.js';
import pytestPoetryDockerfile from '../dockerfiles/pytest-poetry.dockerfile' with { type: 'text' };
import nodeJestDockerfile from '../dockerfiles/node-jest.dockerfile' with { type: 'text' };

/**
 * Fallback Python framework (lowest priority)
 */
export const pytestFallback: Framework = {
  name: 'pytest-fallback',
  detectionPriority: 200,
  dockerfile: pytestPoetryDockerfile, // Reuse poetry dockerfile as fallback

  async detect(testsPath: string): Promise<boolean> {
    try {
      const files = await fs.readdir(testsPath);
      return files.includes('pyproject.toml') || files.includes('requirements.txt');
    } catch {
      return false;
    }
  },

  parseTests(output: string, exitCode: number): boolean {
    // Same as other pytest frameworks
    const failedMatch = output.match(/(\d+) failed/);
    if (failedMatch?.[1] && parseInt(failedMatch[1]) > 0) return false;
    const passedMatch = output.match(/(\d+) passed/);
    if (passedMatch?.[1] && parseInt(passedMatch[1]) > 0) return true;
    return exitCode === 0;
  },
};

/**
 * Fallback Node.js framework (lowest priority)
 */
export const nodeFallback: Framework = {
  name: 'node-fallback',
  detectionPriority: 200,
  dockerfile: nodeJestDockerfile, // Reuse node-jest dockerfile as fallback

  async detect(testsPath: string): Promise<boolean> {
    try {
      const files = await fs.readdir(testsPath);
      // Check for package.json without any lock file (already checked higher priority frameworks)
      if (!files.includes('package.json')) return false;
      // Only match if no lock files present
      const hasLockFile = files.includes('bun.lockb') ||
        files.includes('pnpm-lock.yaml') ||
        files.includes('package-lock.json');
      return !hasLockFile;
    } catch {
      return false;
    }
  },

  parseTests(output: string, exitCode: number): boolean {
    // Could be bun test or jest, check both patterns
    if (output.includes('Tests:') && output.includes('failed')) return false;
    const failMatch = output.match(/(\d+) fail/);
    if (failMatch?.[1] && parseInt(failMatch[1]) > 0) return false;
    return exitCode === 0;
  },
};
