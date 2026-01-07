import { promises as fs } from 'fs';
import path from 'path';
import type { Framework } from './types.js';
import { defaultFrameworks } from './frameworks.js';

export interface FrameworkDetectionResult {
  framework: Framework;
  dockerfilePath: string;
  dockerfileContent: string;
}

/**
 * Detect the appropriate framework for a test repository.
 * Checks frameworks in priority order (lower detectionPriority = checked first).
 *
 * @param testsPath - Path to the test repository
 * @param frameworks - Optional array of frameworks to check (defaults to defaultFrameworks)
 * @returns Detection result with matched framework and dockerfile info
 */
export async function detectFramework(
  testsPath: string,
  frameworks: Framework[] = defaultFrameworks
): Promise<FrameworkDetectionResult> {
  console.log(`[Framework Detection] Checking for framework in: ${testsPath}`);

  // Sort frameworks by priority (lower = higher priority)
  const sortedFrameworks = [...frameworks].sort(
    (a, b) => a.detectionPriority - b.detectionPriority
  );

  for (const framework of sortedFrameworks) {
    const matches = await framework.detect(testsPath);
    if (matches) {
      console.log(`[Framework Detection] Matched: ${framework.name}`);

      const dockerfilePath = path.join(testsPath, 'arkhai_tests.dockerfile');

      // For custom dockerfile framework, read the existing file
      if (framework.name === 'custom') {
        const content = await fs.readFile(dockerfilePath, 'utf-8');
        return {
          framework,
          dockerfilePath,
          dockerfileContent: content,
        };
      }

      return {
        framework,
        dockerfilePath,
        dockerfileContent: framework.dockerfile,
      };
    }
  }

  throw new Error(
    'Could not detect framework. Please add a lock file or arkhai_tests.dockerfile to the test repository.'
  );
}
