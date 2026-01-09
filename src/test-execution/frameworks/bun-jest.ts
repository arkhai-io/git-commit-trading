import { promises as fs } from 'fs';
import type { Framework } from '../types.js';
import bunJestDockerfile from '../dockerfiles/bun-jest.dockerfile' with { type: 'text' };
import { checkForJest } from './utils.js';

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
