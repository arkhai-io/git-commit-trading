import { promises as fs } from 'fs';
import path from 'path';
import type { Framework } from '../types.js';
import bunTestDockerfile from '../dockerfiles/bun-test.dockerfile' with { type: 'text' };
import { checkForJest } from './utils.js';

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
