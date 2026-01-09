import { promises as fs } from 'fs';
import type { Framework } from '../types.js';
import cargoDockerfile from '../dockerfiles/cargo.dockerfile' with { type: 'text' };

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
