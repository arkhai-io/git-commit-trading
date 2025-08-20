import { TestExecutor } from './executor.js';
import type { Config, ExecutionResult, TestResult } from './types.js';
import { loadConfig, validateCommitHash } from './utils.js';

/**
 * SDK interface for programmatic test execution
 */
export class GitTestExecution {
  /**
   * Execute tests with a configuration object
   * @param config - Test execution configuration
   * @param options - Optional execution options
   * @returns Promise<ExecutionResult>
   */
  static async executeTests(config: Config, options?: {
    silent?: boolean;
    onProgress?: (step: string) => void;
  }): Promise<ExecutionResult> {
    const executor = new TestExecutor(config);
    
    // Set up progress callback if provided
    if (options?.onProgress) {
      // You can enhance this to hook into the executor's progress events
    }
    
    return await executor.execute();
  }

  /**
   * Execute tests with a configuration file path
   * @param configPath - Path to configuration file
   * @param options - Optional execution options
   * @returns Promise<ExecutionResult>
   */
  static async executeTestsFromFile(configPath: string, options?: {
    silent?: boolean;
    onProgress?: (step: string) => void;
  }): Promise<ExecutionResult> {
    const config = await loadConfig(configPath);
    return await this.executeTests(config, options);
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
   * Create a sample configuration object
   * @returns Config
   */
  static initConfig(): Config {
    return {
      repositories: {
        source: {
          url: 'https://github.com/your-org/source-repo.git',
          branch: 'main',
          installCommand: 'npm install'
        },
        testcase: {
          url: 'https://github.com/your-org/testcase-repo.git',
          branch: 'main',
          testCommand: 'npm run test',
          buildCommand: 'npm run build',
          installCommand: 'npm install'
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
export type { Config, ExecutionResult, TestResult } from './types.js';
export { TestExecutor } from './executor.js';
