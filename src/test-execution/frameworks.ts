import { promises as fs } from 'fs';
import path from 'path';
import type { Framework } from './types.js';

// Import dockerfiles as text (embedded at compile time for binary builds)
import cargoDockerfile from './dockerfiles/cargo.dockerfile' with { type: 'text' };
import pytestUvDockerfile from './dockerfiles/pytest-uv.dockerfile' with { type: 'text' };
import pytestPoetryDockerfile from './dockerfiles/pytest-poetry.dockerfile' with { type: 'text' };
import bunTestDockerfile from './dockerfiles/bun-test.dockerfile' with { type: 'text' };
import bunJestDockerfile from './dockerfiles/bun-jest.dockerfile' with { type: 'text' };
import nodeJestDockerfile from './dockerfiles/node-jest.dockerfile' with { type: 'text' };
import pnpmJestDockerfile from './dockerfiles/pnpm-jest.dockerfile' with { type: 'text' };

/**
 * Check if a project uses Jest by looking for config files or package.json dependencies
 */
async function checkForJest(projectPath: string, files: string[]): Promise<boolean> {
  if (files.includes('jest.config.js') || files.includes('jest.config.ts') || files.includes('jest.config.json')) {
    return true;
  }

  if (files.includes('package.json')) {
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

      const hasJestDep =
        (packageJson.dependencies && 'jest' in packageJson.dependencies) ||
        (packageJson.devDependencies && 'jest' in packageJson.devDependencies);

      if (hasJestDep) return true;

      if (packageJson.scripts?.test?.includes('jest')) return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Custom dockerfile framework - uses arkhai_tests.dockerfile from the test repo
 */
export const customDockerfile: Framework = {
  name: 'custom',
  dockerfile: '', // Will be read from arkhai_tests.dockerfile
  detectionPriority: 0, // Highest priority - always checked first

  async detect(testsPath: string): Promise<boolean> {
    try {
      const files = await fs.readdir(testsPath);
      return files.includes('arkhai_tests.dockerfile');
    } catch {
      return false;
    }
  },

  parseTests(output: string, exitCode: number): boolean {
    // For custom dockerfiles, rely on exit code
    return exitCode === 0;
  },
};

/**
 * Rust Cargo framework
 */
export const cargo: Framework = {
  name: 'cargo',
  detectionPriority: 10,
  dockerfile: cargoDockerfile,

  async detect(testsPath: string): Promise<boolean> {
    try {
      const files = await fs.readdir(testsPath);
      return files.includes('Cargo.lock') || files.includes('Cargo.toml');
    } catch {
      return false;
    }
  },

  parseTests(output: string, exitCode: number): boolean {
    // cargo test outputs "test result: ok" on success, "test result: FAILED" on failure
    if (output.includes('test result: ok')) return true;
    if (output.includes('test result: FAILED')) return false;
    return exitCode === 0;
  },
};

/**
 * Python with UV + Pytest framework
 */
export const pytestUv: Framework = {
  name: 'pytest-uv',
  detectionPriority: 10,
  dockerfile: pytestUvDockerfile,

  async detect(testsPath: string): Promise<boolean> {
    try {
      const files = await fs.readdir(testsPath);
      return files.includes('uv.lock');
    } catch {
      return false;
    }
  },

  parseTests(output: string, exitCode: number): boolean {
    // pytest outputs summary like "X passed" or "X failed"
    const failedMatch = output.match(/(\d+) failed/);
    if (failedMatch?.[1] && parseInt(failedMatch[1]) > 0) return false;
    const passedMatch = output.match(/(\d+) passed/);
    if (passedMatch?.[1] && parseInt(passedMatch[1]) > 0) return true;
    return exitCode === 0;
  },
};

/**
 * Python with Poetry + Pytest framework
 */
export const pytestPoetry: Framework = {
  name: 'pytest-poetry',
  detectionPriority: 10,
  dockerfile: pytestPoetryDockerfile,

  async detect(testsPath: string): Promise<boolean> {
    try {
      const files = await fs.readdir(testsPath);
      return files.includes('poetry.lock');
    } catch {
      return false;
    }
  },

  parseTests(output: string, exitCode: number): boolean {
    // Same as pytestUv - pytest output format
    const failedMatch = output.match(/(\d+) failed/);
    if (failedMatch?.[1] && parseInt(failedMatch[1]) > 0) return false;
    const passedMatch = output.match(/(\d+) passed/);
    if (passedMatch?.[1] && parseInt(passedMatch[1]) > 0) return true;
    return exitCode === 0;
  },
};

/**
 * Bun with native bun:test framework
 */
export const bunTest: Framework = {
  name: 'bun-test',
  detectionPriority: 10,
  dockerfile: bunTestDockerfile,

  async detect(testsPath: string): Promise<boolean> {
    try {
      const files = await fs.readdir(testsPath);
      if (!files.includes('bun.lockb')) return false;
      // Check that it's NOT using Jest
      const hasJest = await checkForJest(testsPath, files);
      return !hasJest;
    } catch {
      return false;
    }
  },

  parseTests(output: string, exitCode: number): boolean {
    // bun test outputs "X pass" and "X fail"
    const failMatch = output.match(/(\d+) fail/);
    if (failMatch?.[1] && parseInt(failMatch[1]) > 0) return false;
    const passMatch = output.match(/(\d+) pass/);
    if (passMatch?.[1] && parseInt(passMatch[1]) > 0) return true;
    return exitCode === 0;
  },
};

/**
 * Bun with Jest framework
 */
export const bunJest: Framework = {
  name: 'bun-jest',
  detectionPriority: 10,
  dockerfile: bunJestDockerfile,

  async detect(testsPath: string): Promise<boolean> {
    try {
      const files = await fs.readdir(testsPath);
      if (!files.includes('bun.lockb')) return false;
      return await checkForJest(testsPath, files);
    } catch {
      return false;
    }
  },

  parseTests(output: string, exitCode: number): boolean {
    // Jest outputs "Tests: X passed" or "Tests: X failed"
    if (output.includes('Tests:') && output.includes('failed')) return false;
    if (output.includes('Tests:') && output.includes('passed')) return true;
    return exitCode === 0;
  },
};

/**
 * Node.js with Jest framework
 */
export const nodeJest: Framework = {
  name: 'node-jest',
  detectionPriority: 10,
  dockerfile: nodeJestDockerfile,

  async detect(testsPath: string): Promise<boolean> {
    try {
      const files = await fs.readdir(testsPath);
      return files.includes('package-lock.json');
    } catch {
      return false;
    }
  },

  parseTests(output: string, exitCode: number): boolean {
    // Jest outputs "Tests: X passed" or "Tests: X failed"
    if (output.includes('Tests:') && output.includes('failed')) return false;
    if (output.includes('Tests:') && output.includes('passed')) return true;
    return exitCode === 0;
  },
};

/**
 * PNPM with Jest framework
 */
export const pnpmJest: Framework = {
  name: 'pnpm-jest',
  detectionPriority: 10,
  dockerfile: pnpmJestDockerfile,

  async detect(testsPath: string): Promise<boolean> {
    try {
      const files = await fs.readdir(testsPath);
      return files.includes('pnpm-lock.yaml');
    } catch {
      return false;
    }
  },

  parseTests(output: string, exitCode: number): boolean {
    // Jest outputs "Tests: X passed" or "Tests: X failed"
    if (output.includes('Tests:') && output.includes('failed')) return false;
    if (output.includes('Tests:') && output.includes('passed')) return true;
    return exitCode === 0;
  },
};

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

/**
 * All default frameworks in detection priority order
 */
export const defaultFrameworks: Framework[] = [
  customDockerfile, // Priority 0
  cargo,            // Priority 10
  pytestUv,         // Priority 10
  pytestPoetry,     // Priority 10
  bunTest,          // Priority 10
  bunJest,          // Priority 10
  nodeJest,         // Priority 10
  pnpmJest,         // Priority 10
  pytestFallback,   // Priority 200
  nodeFallback,     // Priority 200
].sort((a, b) => a.detectionPriority - b.detectionPriority);
