import chalk from 'chalk';
import { SdkFactory } from './sdks/factory.js';
import { GitTestExecution } from './sdk.js';
import type { Config } from './types.js';

export interface OracleExecutorOptions {
  sdkType?: string;
  sourceCommit?: string;
  testcaseCommit?: string;
  sourceCommitAlgo?: string;
  testcaseCommitAlgo?: string;
}

export class OracleExecutor {
  constructor(private config: Config) {}

  async executeWithSdk(obligation: any, demand: any, options: OracleExecutorOptions = {}): Promise<boolean> {
    try {
      console.log(chalk.cyan('🔧 Starting Oracle execution with SDK...'));

      // Step 1: Handle test execution in git-app
      const testResult = await this.executeTestsInGitApp(obligation, demand, options);
      
      // Step 2: Use SDK for oracle client creation and result submission
      const sdkResult = await this.submitResultWithSdk(testResult, obligation, demand, options.sdkType);
      
      return sdkResult;
    } catch (error) {
      console.error(chalk.red('❌ Oracle execution failed:'), error);
      return false;
    }
  }

  private async executeTestsInGitApp(obligation: any, demand: any, options: OracleExecutorOptions): Promise<boolean> {
    try {
      console.log(chalk.blue('📋 Executing tests in git-app...'));
      
      // Configure test execution based on obligation and demand
      const testConfig = this.createTestConfigFromDemand(obligation, demand, options);
      
      console.log(`📁 Source: ${testConfig.repositories.source.url} (${testConfig.repositories.source.commitHash})`);
      console.log(`🧪 Testcase: ${testConfig.repositories.testcase.url} (${testConfig.repositories.testcase.commitHash})`);

      // Execute tests using GitTestExecution
      const result = await GitTestExecution.executeTests(testConfig);
      
      console.log(`✅ Test execution result: ${result.testResult.success}`);
      return result.testResult.success;
      
    } catch (error) {
      console.error('❌ Error during test execution in git-app:', error);
      return false;
    }
  }

  private async submitResultWithSdk(testResult: boolean, obligation: any, demand: any, sdkType?: string): Promise<boolean> {
    try {
      console.log(chalk.blue('📤 Submitting result using SDK...'));
      
      // Get SDK type from config or options
      const selectedSdkType = sdkType || this.config.sdkType || 'typescript';
      
      // Create SDK instance
      const sdk = SdkFactory.createSdk(selectedSdkType);
      
      // Validate SDK
      const isValid = await sdk.validateSdk();
      if (!isValid) {
        console.error(`❌ SDK validation failed for: ${selectedSdkType}`);
        return false;
      }
      
      // Submit arbitration result via SDK
      const success = await sdk.submitArbitrationResult(testResult, obligation, demand);
      
      console.log(`✅ Result submission: ${success}`);
      return success;
      
    } catch (error) {
      console.error('❌ Error during result submission with SDK:', error);
      return false;
    }
  }

  private createTestConfigFromDemand(obligation: any, demand: any, options: OracleExecutorOptions): Config {
    const testConfig = GitTestExecution.initConfig();
    
    // Configure repositories from obligation and demand
    testConfig.repositories.testcase.url = demand[0].hosts[0];
    testConfig.repositories.testcase.commitHash = demand[0].testsCommitHash;
    testConfig.repositories.testcase.testCommand = demand[0].testsCommand || 'npm test';
    
    testConfig.repositories.source.url = obligation[0].hosts[0];
    testConfig.repositories.source.commitHash = obligation[0].commitHash;
    
    // Apply overrides from options
    if (options.sourceCommit) {
      testConfig.repositories.source.commitHash = options.sourceCommit;
    }
    
    if (options.testcaseCommit) {
      testConfig.repositories.testcase.commitHash = options.testcaseCommit;
    }
    
    // Set commit algorithms if provided
    if (options.sourceCommitAlgo) {
      testConfig.repositories.source.commitAlgo = this.mapCommitAlgo(options.sourceCommitAlgo);
    } else if (obligation[0].commitAlgo !== undefined) {
      testConfig.repositories.source.commitAlgo = this.mapCommitAlgo(obligation[0].commitAlgo);
    }
    
    if (options.testcaseCommitAlgo) {
      testConfig.repositories.testcase.commitAlgo = this.mapCommitAlgo(options.testcaseCommitAlgo);
    } else if (demand[0].testsCommitAlgo !== undefined) {
      testConfig.repositories.testcase.commitAlgo = this.mapCommitAlgo(demand[0].testsCommitAlgo);
    }

    return testConfig;
  }

  private mapCommitAlgo(algo: number | string): 'sha256' | 'md5' | 'sha1' {
    if (typeof algo === 'string') {
      return algo as 'sha256' | 'md5' | 'sha1';
    }
    
    switch (algo) {
      case 0: return 'sha1';
      case 1: return 'sha256'; 
      case 2: return 'md5';
      default: return 'sha1';
    }
  }
}
