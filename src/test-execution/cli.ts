#!/usr/bin/env node
import { Command } from 'commander';
import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';
import type { Config } from './types.js';
import { TestExecutor } from './executor.js';
import { Logger, loadConfig } from './utils.js';

const program = new Command();

async function executeTests(configPath: string, options: any) {
  try {
    console.log(chalk.cyan('Starting test execution...'));
    let config = await loadConfig(configPath);
    
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

async function generateSampleConfig(outputPath: string) {
  const sampleConfig: Config = {
    repositories: {
      source: {
        url: 'https://github.com/your-org/source-repo.git',
        branch: 'main',
        commitHash: '', // Optional: specific commit hash to checkout
        commitAlgo: 'sha1', // Optional: commit hash algorithm (sha256, md5, or sha1)
        installCommand: 'npm install'
      },
      testcase: {
        url: 'https://github.com/your-org/testcase-repo.git',
        branch: 'main',
        commitHash: '', // Optional: specific commit hash to checkout
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
  .option('--source-commit <hash>', 'Override source repository commit hash')
  .option('--testcase-commit <hash>', 'Override testcase repository commit hash')
  .option('--source-commit-algo <algo>', 'Override source repository commit algorithm (sha256|md5|sha1)')
  .option('--testcase-commit-algo <algo>', 'Override testcase repository commit algorithm (sha256|md5|sha1)')
  .action(async (options) => {
    await executeTests(options.config, options);
  });

program
  .command('validate')
  .description('Validate the configuration file')
  .option('-c, --config <path>', 'Path to configuration file', './config.json')
  .action(async (options) => {
    await validateConfig(options.config);
  });

program
  .command('generate-config')
  .description('Generate a sample configuration file')
  .option('-o, --output <path>', 'Output path for the configuration file', './config.sample.json')
  .action(async (options) => {
    await generateSampleConfig(options.output);
  });

program.parse();
