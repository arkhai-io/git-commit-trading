import { promises as fs } from 'fs';
import path from 'path';
import type { FrameworkType } from './types.js';
import { getDockerfileContent } from './dockerfileTemplates.js';

export interface FrameworkDetectionResult {
  framework: FrameworkType;
  dockerfilePath: string; // Path where dockerfile will be written (in test repo)
  dockerfileContent?: string; // Content of the dockerfile (for default frameworks)
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Detect framework type by checking for lock files and configuration
 * Priority: Lock files > Package manager files
 * Note: If arkhai_tests.dockerfile exists, we use it instead of generating a template
 */
export async function detectFramework(testRepoPath: string): Promise<FrameworkDetectionResult> {
  try {
    const files = await fs.readdir(testRepoPath);

    // Check if custom dockerfile exists first - if so, use it instead of template
    const customDockerfilePath = path.join(testRepoPath, 'arkhai_tests.dockerfile');
    const hasCustomDockerfile = files.includes('arkhai_tests.dockerfile');
    
    console.log(`[Framework Detection] Checking for custom dockerfile in: ${testRepoPath}`);
    console.log(`[Framework Detection] Files found: ${files.join(', ')}`);
    console.log(`[Framework Detection] Custom dockerfile exists: ${hasCustomDockerfile}`);
    
    if (hasCustomDockerfile) {
      // Detect framework for logging purposes, but don't provide template content
      let detectedFramework: FrameworkType = 'custom';
      if (files.includes('Cargo.lock') || files.includes('Cargo.toml')) {
        detectedFramework = 'cargo';
      } else if (files.includes('uv.lock')) {
        detectedFramework = 'pytest-uv';
      } else if (files.includes('poetry.lock')) {
        detectedFramework = 'pytest-poetry';
      } else if (files.includes('bun.lockb')) {
        detectedFramework = await checkForJest(testRepoPath, files) ? 'bun-jest' : 'bun-test';
      } else if (files.includes('pnpm-lock.yaml')) {
        detectedFramework = 'pnpm-jest';
      } else if (files.includes('package-lock.json')) {
        detectedFramework = 'node-jest';
      } else if (files.includes('pyproject.toml') || files.includes('requirements.txt')) {
        detectedFramework = 'pytest-poetry';
      }
      
      return {
        framework: detectedFramework,
        dockerfilePath: customDockerfilePath,
        dockerfileContent: undefined, // Don't overwrite custom dockerfile
        confidence: 'high'
      };
    }

    // Check for Rust - Cargo.lock
    if (files.includes('Cargo.lock') || files.includes('Cargo.toml')) {
      return {
        framework: 'cargo',
        dockerfilePath: path.join(testRepoPath, 'arkhai_tests.dockerfile'),
        dockerfileContent: getDockerfileContent('cargo'),
        confidence: 'high'
      };
    }

    // Check for Python with uv - uv.lock
    if (files.includes('uv.lock')) {
      return {
        framework: 'pytest-uv',
        dockerfilePath: path.join(testRepoPath, 'arkhai_tests.dockerfile'),
        dockerfileContent: getDockerfileContent('pytest-uv'),
        confidence: 'high'
      };
    }

    // Check for Python with Poetry - poetry.lock
    if (files.includes('poetry.lock')) {
      return {
        framework: 'pytest-poetry',
        dockerfilePath: path.join(testRepoPath, 'arkhai_tests.dockerfile'),
        dockerfileContent: getDockerfileContent('pytest-poetry'),
        confidence: 'high'
      };
    }

    // Check for Bun - bun.lockb
    if (files.includes('bun.lockb')) {
      // Check if using Jest
      const hasJest = await checkForJest(testRepoPath, files);
      const framework = hasJest ? 'bun-jest' : 'bun-test';
      return {
        framework,
        dockerfilePath: path.join(testRepoPath, 'arkhai_tests.dockerfile'),
        dockerfileContent: getDockerfileContent(framework),
        confidence: 'high'
      };
    }

    // Check for PNPM - pnpm-lock.yaml
    if (files.includes('pnpm-lock.yaml')) {
      return {
        framework: 'pnpm-jest',
        dockerfilePath: path.join(testRepoPath, 'arkhai_tests.dockerfile'),
        dockerfileContent: getDockerfileContent('pnpm-jest'),
        confidence: 'high'
      };
    }

    // Check for NPM - package-lock.json
    if (files.includes('package-lock.json')) {
      return {
        framework: 'node-jest',
        dockerfilePath: path.join(testRepoPath, 'arkhai_tests.dockerfile'),
        dockerfileContent: getDockerfileContent('node-jest'),
        confidence: 'high'
      };
    }

    // Fallback: Check package.json without lock file (lower confidence)
    if (files.includes('package.json')) {
      const hasJest = await checkForJest(testRepoPath, files);
      // Default to node-jest if no specific lock file found
      const framework = hasJest ? 'node-jest' : 'bun-test';
      return {
        framework,
        dockerfilePath: path.join(testRepoPath, 'arkhai_tests.dockerfile'),
        dockerfileContent: getDockerfileContent(framework),
        confidence: 'medium'
      };
    }

    // Check for Python without specific lock (lowest confidence)
    if (files.includes('pyproject.toml') || files.includes('requirements.txt')) {
      return {
        framework: 'pytest-poetry',
        dockerfilePath: path.join(testRepoPath, 'arkhai_tests.dockerfile'),
        dockerfileContent: getDockerfileContent('pytest-poetry'),
        confidence: 'low'
      };
    }

    // No framework detected
    throw new Error('Could not detect framework. Please add a lock file or arkhai_tests.dockerfile to the test repository.');
    
  } catch (error) {
    throw new Error(`Framework detection failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Check if the project uses Jest
 */
async function checkForJest(projectPath: string, files: string[]): Promise<boolean> {
  // Check for jest.config.js/ts
  if (files.includes('jest.config.js') || files.includes('jest.config.ts') || files.includes('jest.config.json')) {
    return true;
  }

  // Check package.json for jest dependency
  if (files.includes('package.json')) {
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      
      const hasJestDep = 
        (packageJson.dependencies && 'jest' in packageJson.dependencies) ||
        (packageJson.devDependencies && 'jest' in packageJson.devDependencies);
      
      if (hasJestDep) {
        return true;
      }

      // Check if test script uses jest
      if (packageJson.scripts && packageJson.scripts.test) {
        return packageJson.scripts.test.includes('jest');
      }
    } catch (error) {
      // If can't read package.json, assume no Jest
      return false;
    }
  }

  return false;
}
