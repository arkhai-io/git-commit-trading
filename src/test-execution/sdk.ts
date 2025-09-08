import { TestExecutor } from './executor.js';
import type { Config, ExecutionResult, TestResult, ProjectLanguage } from './types.js';
import { loadConfig, validateCommitHash } from './utils.js';
import { detectProjectCommands } from './projectDetection.js';

/**
 * SDK interface for programmatic test execution
 */
export class GitTestExecution {
  /**
   * Execute tests with a configuration object
   * @param config - Test execution configuration
   * @param options - Optional execution options
   * @returns Promise<ExecutionResult & { detectedLanguage: ProjectLanguage | null }>
   */
  static async executeTests(config: Config, options?: {
    silent?: boolean;
    onProgress?: (step: string) => void;
  }): Promise<ExecutionResult & { detectedLanguage: ProjectLanguage | null }> {
    const executor = new TestExecutor(config);
    
    // Set up progress callback if provided
    if (options?.onProgress) {
      // You can enhance this to hook into the executor's progress events
    }
    
    const result = await executor.execute();
    return {
      ...result,
      detectedLanguage: executor.getDetectedLanguage()
    };
  }

  /**
   * Execute tests with a configuration file path
   * @param configPath - Path to configuration file
   * @param options - Optional execution options
   * @returns Promise<ExecutionResult & { detectedLanguage: ProjectLanguage | null }>
   */
  static async executeTestsFromFile(configPath: string, options?: {
    silent?: boolean;
    onProgress?: (step: string) => void;
  }): Promise<ExecutionResult & { detectedLanguage: ProjectLanguage | null }> {
    const config = await loadConfig(configPath);
    return await this.executeTests(config, options);
  }

  /**
   * Detect project language from a directory
   * @param projectPath - Path to the project directory
   * @returns Promise<ProjectLanguage | null>
   */
  static async detectLanguage(projectPath: string): Promise<ProjectLanguage | null> {
    const result = await detectProjectCommands(projectPath);
    return result.language;
  }

  /**
   * Validate a configuration object
   * @param config - Configuration to validate
   * @returns Promise<boolean>
   */
  static async validateConfig(config: Config): Promise<boolean> {
    try {
      // Basic validation - check required URLs
      if (!config.repositories?.source?.url || !config.repositories?.testcase?.url) {
        return false;
      }
      
      // Validate commit hashes if provided
      const sourceRepo = config.repositories.source;
      if (sourceRepo.commitHash && sourceRepo.commitAlgo) {
        if (!validateCommitHash(sourceRepo.commitHash, sourceRepo.commitAlgo)) {
          return false;
        }
      }
      
      const testcaseRepo = config.repositories.testcase;
      if (testcaseRepo.commitHash && testcaseRepo.commitAlgo) {
        if (!validateCommitHash(testcaseRepo.commitHash, testcaseRepo.commitAlgo)) {
          return false;
        }
      }
      
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate a configuration file
   * @param configPath - Path to configuration file
   * @returns Promise<boolean>
   */
  static async validateConfigFile(configPath: string): Promise<boolean> {
    try {
      const config = await loadConfig(configPath);
      return await this.validateConfig(config);
    } catch {
      return false;
    }
  }

  /**
   * Create a sample configuration object for TypeScript projects
   * @returns Config
   */
  static initConfig(): Config {
    return {
      repositories: {
        source: {
          url: 'https://github.com/your-org/source-repo/archive/{commit-sha}.tar.gz',
          commitHash: 'abc123def456', // Required: specific commit hash
          language: 'typescript' // Optional: specify language explicitly
        },
        testcase: {
          url: 'https://github.com/your-org/testcase-repo/archive/{commit-sha}.tar.gz',
          commitHash: 'def456ghi789', // Required: specific commit hash
          language: 'typescript' // Optional: specify language explicitly
        }
      },
      execution: {
        timeout: 300000,
        cleanupAfterExecution: true,
        isolatedEnvironment: true,
        tempDirectory: './temp'
      }
    };
  }

  /**
   * Create a sample configuration object for Rust projects
   * @returns Config
   */
  static initRustConfig(): Config {
    return {
      repositories: {
        source: {
          url: 'https://github.com/your-org/rust-solution/archive/{commit-sha}.tar.gz',
          commitHash: 'abc123def456',
          language: 'rust',
          buildCommand: 'cargo build --release',
          testCommand: 'cargo test'
        },
        testcase: {
          url: 'https://github.com/your-org/rust-tests/archive/{commit-sha}.tar.gz',
          commitHash: 'def456ghi789',
          language: 'rust',
          testCommand: 'cargo test'
        }
      },
      execution: {
        timeout: 300000,
        cleanupAfterExecution: true,
        isolatedEnvironment: true,
        tempDirectory: './temp'
      }
    };
  }

  /**
   * Create a sample configuration object for Python projects
   * @returns Config
   */
  static initPythonConfig(): Config {
    return {
      repositories: {
        source: {
          url: 'https://github.com/your-org/python-solution/archive/{commit-sha}.tar.gz',
          commitHash: 'abc123def456',
          language: 'python',
          installCommand: 'pip install -r requirements.txt',
          testCommand: 'pytest'
        },
        testcase: {
          url: 'https://github.com/your-org/python-tests/archive/{commit-sha}.tar.gz',
          commitHash: 'def456ghi789',
          language: 'python',
          installCommand: 'pip install -r requirements.txt',
          testCommand: 'pytest'
        }
      },
      execution: {
        timeout: 300000,
        cleanupAfterExecution: true,
        isolatedEnvironment: true,
        tempDirectory: './temp'
      }
    };
  }
}

// Export types for external use
export type { Config, ExecutionResult, TestResult, ProjectLanguage } from './types.js';
export { TestExecutor } from './executor.js';
