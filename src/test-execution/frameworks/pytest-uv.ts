import { promises as fs } from 'fs';
import type { Framework } from '../types.js';
import pytestUvDockerfile from '../dockerfiles/pytest-uv.dockerfile' with { type: 'text' };

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
