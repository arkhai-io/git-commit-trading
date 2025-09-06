#!/usr/bin/env node
import { Command } from 'commander';
import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';
import type { Config } from './types.js';
import { TestExecutor } from './executor.js';
import { OracleExecutor } from './oracle-executor.js';
import { Logger, loadConfig } from './utils.js';
import { SdkFactory } from './sdks/factory.js';

const program = new Command();

async function executeTests(configPath: string, options: any) {
  try {
    console.log(chalk.cyan('Starting test execution...'));
    let config = await loadConfig(configPath);
    
    // Override SDK type if provided via CLI
    if (options.sdkType) {
      config.sdkType = options.sdkType;
      console.log(chalk.yellow(`Override SDK type: ${options.sdkType}`));
    }
    
    // Override commit hashes if provided via CLI
    if (options.sourceCommit) {
      config.repositories.source.commitHash = options.sourceCommit;
      console.log(chalk.yellow(`Override source commit: ${options.sourceCommit}`));
    }
    
    if (options.testcaseCommit) {
      config.repositories.testcase.commitHash = options.testcaseCommit;
      console.log(chalk.yellow(`Override testcase commit: ${options.testcaseCommit}`));
    }
    
    // Override commit algorithms if provided via CLI
    if (options.sourceCommitAlgo) {
      config.repositories.source.commitAlgo = options.sourceCommitAlgo;
      console.log(chalk.yellow(`Override source commit algorithm: ${options.sourceCommitAlgo}`));
    }
    
    if (options.testcaseCommitAlgo) {
      config.repositories.testcase.commitAlgo = options.testcaseCommitAlgo;
      console.log(chalk.yellow(`Override testcase commit algorithm: ${options.testcaseCommitAlgo}`));
    }
    
    const executor = new TestExecutor(config);
    
    const startTime = Date.now();
    const result = await executor.execute();
    const totalDuration = Date.now() - startTime;
    
    // Simple final result
    console.log();
    if (result.testResult.success) {
      console.log(chalk.bold.green('✅ TESTS PASSED'));
      console.log(chalk.gray(`   Duration: ${totalDuration}ms`));
    } else {
      console.log(chalk.bold.red('❌ TESTS FAILED'));
      console.log(chalk.gray(`   Duration: ${totalDuration}ms`));
      if (result.testResult.error) {
        console.log(chalk.red(`   Error: ${result.testResult.error}`));
      }
    }
    
    // Set exit code based on test results
    process.exit(result.testResult.success ? 0 : 1);
    
  } catch (error) {
    console.log(chalk.bold.red('❌ EXECUTION FAILED'));
    console.log(chalk.red(`   ${error}`));
    process.exit(1);
  }
}

async function validateConfig(configPath: string) {
  try {
    const config = await loadConfig(configPath);
    console.log(chalk.green('✅ Configuration is valid'));
  } catch (error) {
    console.log(chalk.red('❌ Configuration is invalid'));
    console.log(chalk.red(`   ${error}`));
    process.exit(1);
  }
}

async function executeOracleWithSdk(options: any) {
  try {
    console.log(chalk.cyan('Starting Oracle execution with SDK...'));
    
    if (!options.obligation || !options.demand) {
      console.error(chalk.red('❌ Both --obligation and --demand must be provided as JSON strings'));
      process.exit(1);
    }
    
    let obligation, demand;
    try {
      obligation = JSON.parse(options.obligation);
      demand = JSON.parse(options.demand);
    } catch (parseError) {
      console.error(chalk.red('❌ Failed to parse obligation or demand JSON:', parseError));
      process.exit(1);
    }
    
    const config = await loadConfig(options.config);
    const oracleExecutor = new OracleExecutor(config);
    
    const startTime = Date.now();
    const result = await oracleExecutor.executeWithSdk(obligation, demand, {
      sdkType: options.sdkType,
      sourceCommit: options.sourceCommit,
      testcaseCommit: options.testcaseCommit,
      sourceCommitAlgo: options.sourceCommitAlgo,
      testcaseCommitAlgo: options.testcaseCommitAlgo
    });
    const totalDuration = Date.now() - startTime;
    
    // Final result
    console.log();
    if (result) {
      console.log(chalk.bold.green('✅ ORACLE EXECUTION SUCCESSFUL'));
      console.log(chalk.gray(`   Duration: ${totalDuration}ms`));
    } else {
      console.log(chalk.bold.red('❌ ORACLE EXECUTION FAILED'));
      console.log(chalk.gray(`   Duration: ${totalDuration}ms`));
    }
    
    // Set exit code based on oracle results
    process.exit(result ? 0 : 1);
    
  } catch (error) {
    console.log(chalk.bold.red('❌ ORACLE EXECUTION FAILED'));
    console.log(chalk.red(`   ${error}`));
    process.exit(1);
  }
}

async function validateSdks() {
  try {
    console.log(chalk.cyan('🔍 Validating available SDKs...'));
    const results = await SdkFactory.validateAllSdks();
    
    console.log(chalk.bold('\nSDK Validation Results:'));
    for (const [sdkType, isValid] of Object.entries(results)) {
      if (isValid) {
        console.log(chalk.green(`  ✅ ${sdkType.charAt(0).toUpperCase() + sdkType.slice(1)} SDK: Available`));
      } else {
        console.log(chalk.red(`  ❌ ${sdkType.charAt(0).toUpperCase() + sdkType.slice(1)} SDK: Not available`));
      }
    }
    
    const validSdks = Object.values(results).filter(Boolean).length;
    console.log(chalk.cyan(`\n📊 Summary: ${validSdks}/${Object.keys(results).length} SDKs available`));
    
    if (validSdks === 0) {
      console.log(chalk.yellow('⚠️  No SDKs are available. Please install at least one SDK.'));
      process.exit(1);
    }
  } catch (error) {
    console.log(chalk.red('❌ SDK validation failed'));
    console.log(chalk.red(`   ${error}`));
    process.exit(1);
  }
}

async function generateSampleConfig(outputPath: string) {
  const sampleConfig: Config = {
    sdkType: 'typescript', // Default SDK type
    repositories: {
      source: {
        url: 'https://github.com/your-org/source-repo/archive/{commit-sha}.tar.gz',
        commitHash: 'abc123def456', // Required: specific commit hash
        commitAlgo: 'sha1', // Optional: commit hash algorithm (sha256, md5, or sha1)
        installCommand: 'npm install'
      },
      testcase: {
        url: 'https://github.com/your-org/testcase-repo/archive/{commit-sha}.tar.gz',
        commitHash: 'def456ghi789', // Required: specific commit hash
        commitAlgo: 'sha1', // Optional: commit hash algorithm (sha256, md5, or sha1)
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
  
  await fs.writeFile(outputPath, JSON.stringify(sampleConfig, null, 2));
  console.log(chalk.green(`✅ Sample configuration generated: ${outputPath}`));
}

program
  .name('test-execution-app')
  .description('Execute tests from separate repositories in isolated environments')
  .version('1.0.0');

program
  .command('oracle')
  .description('Execute tests using the specified configuration')
  .option('-c, --config <path>', 'Path to configuration file', './config.json')
  .option('--sdk-type <type>', 'SDK type to use (typescript|rust|python)', 'typescript')
  .option('--source-commit <hash>', 'Override source repository commit hash')
  .option('--testcase-commit <hash>', 'Override testcase repository commit hash')
  .option('--source-commit-algo <algo>', 'Override source repository commit algorithm (sha256|md5|sha1)')
  .option('--testcase-commit-algo <algo>', 'Override testcase repository commit algorithm (sha256|md5|sha1)')
  .action(async (options) => {
    await executeTests(options.config, options);
  });

program
  .command('oracle-sdk')
  .description('Execute oracle arbitration using SDK (with obligation and demand)')
  .option('-c, --config <path>', 'Path to configuration file', './config.json')
  .option('--sdk-type <type>', 'SDK type to use (typescript|rust|python)', 'typescript')
  .option('--source-commit <hash>', 'Override source repository commit hash')
  .option('--testcase-commit <hash>', 'Override testcase repository commit hash')
  .option('--source-commit-algo <algo>', 'Override source repository commit algorithm (sha256|md5|sha1)')
  .option('--testcase-commit-algo <algo>', 'Override testcase repository commit algorithm (sha256|md5|sha1)')
  .option('--obligation <json>', 'Obligation data as JSON string')
  .option('--demand <json>', 'Demand data as JSON string')
  .action(async (options) => {
    await executeOracleWithSdk(options);
  });

program
  .command('validate')
  .description('Validate the configuration file')
  .option('-c, --config <path>', 'Path to configuration file', './config.json')
  .action(async (options) => {
    await validateConfig(options.config);
  });

program
  .command('validate-sdks')
  .description('Validate all available SDKs')
  .action(async () => {
    await validateSdks();
  });

program
  .command('generate-config')
  .description('Generate a sample configuration file')
  .option('-o, --output <path>', 'Output path for the configuration file', './config.sample.json')
  .action(async (options) => {
    await generateSampleConfig(options.output);
  });

program.parse();
