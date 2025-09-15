#!/usr/bin/env node
import { Command } from 'commander';
import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';
import type { Config, ProjectLanguage } from './types.js';
import { TestExecutor } from './executor.js';
import { Logger, loadConfig } from './utils.js';
import { detectProjectCommands } from './projectDetection.js';

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
    
    // Override languages if provided via CLI
    if (options.sourceLanguage) {
      config.repositories.source.language = options.sourceLanguage as ProjectLanguage;
      console.log(chalk.yellow(`Override source language: ${options.sourceLanguage}`));
    }
    
    if (options.testcaseLanguage) {
      config.repositories.testcase.language = options.testcaseLanguage as ProjectLanguage;
      console.log(chalk.yellow(`Override testcase language: ${options.testcaseLanguage}`));
    }
    
    // Override signature verification options if provided via CLI
    if (options.verifySignatures !== undefined) {
      config.execution.verifyCommitSignatures = options.verifySignatures;
      console.log(chalk.yellow(`Override signature verification: ${options.verifySignatures}`));
    }
    
    if (options.contractAddress) {
      config.execution.contractAddress = options.contractAddress;
      console.log(chalk.yellow(`Override contract address: ${options.contractAddress}`));
    }
    
    if (options.fallbackToGithub !== undefined) {
      config.execution.fallbackToGitHub = options.fallbackToGithub;
      console.log(chalk.yellow(`Override GitHub fallback: ${options.fallbackToGithub}`));
    }
    
    const executor = new TestExecutor(config);
    
    const startTime = Date.now();
    const result = await executor.execute();
    const totalDuration = Date.now() - startTime;
    const detectedLanguage = executor.getDetectedLanguage();
    
    // Display language information
    if (detectedLanguage) {
      console.log(chalk.blue(`🔍 Detected project language: ${detectedLanguage}`));
    }
    
    // Simple final result
    console.log();
    if (result.testResult.success) {
      console.log(chalk.bold.green('✅ TESTS PASSED'));
      console.log(chalk.gray(`   Duration: ${totalDuration}ms`));
      if (detectedLanguage) {
        console.log(chalk.gray(`   Language: ${detectedLanguage}`));
      }
    } else {
      console.log(chalk.bold.red('❌ TESTS FAILED'));
      console.log(chalk.gray(`   Duration: ${totalDuration}ms`));
      if (detectedLanguage) {
        console.log(chalk.gray(`   Language: ${detectedLanguage}`));
      }
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

async function generateSampleConfig(outputPath: string, language: ProjectLanguage = 'typescript') {
  let sampleConfig: Config;
  
  switch (language) {
    case 'rust':
      sampleConfig = {
        repositories: {
          source: {
            url: 'https://github.com/your-org/rust-solution.git',
            commitHash: 'abc123def456',
            commitAlgo: 'sha1',
            language: 'rust',
            buildCommand: 'cargo build --release',
            testCommand: 'cargo test',
            installCommand: 'cargo build'
          },
          testcase: {
            url: 'https://github.com/your-org/rust-tests.git',
            commitHash: 'def456ghi789',
            commitAlgo: 'sha1',
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
      break;
    case 'python':
      sampleConfig = {
        repositories: {
          source: {
            url: 'https://github.com/your-org/python-solution.git',
            commitHash: 'abc123def456',
            commitAlgo: 'sha1',
            language: 'python',
            installCommand: 'pip install -r requirements.txt',
            testCommand: 'pytest -v',
            buildCommand: 'echo "No build needed for Python"'
          },
          testcase: {
            url: 'https://github.com/your-org/python-tests.git',
            commitHash: 'def456ghi789',
            commitAlgo: 'sha1',
            language: 'python',
            installCommand: 'pip install -r requirements.txt',
            testCommand: 'pytest -v'
          }
        },
        execution: {
          timeout: 300000,
          cleanupAfterExecution: true,
          isolatedEnvironment: true,
          tempDirectory: './temp'
        }
      };
      break;
    default: // typescript
      sampleConfig = {
        repositories: {
          source: {
            url: 'https://github.com/your-org/source-repo.git',
            commitHash: 'abc123def456',
            commitAlgo: 'sha1',
            language: 'typescript',
            buildCommand: 'bun run build',
            testCommand: 'bun test',
            installCommand: 'bun install'
          },
          testcase: {
            url: 'https://github.com/your-org/testcase-repo.git',
            commitHash: 'def456ghi789',
            commitAlgo: 'sha1',
            language: 'typescript',
            testCommand: 'bun test',
            buildCommand: 'bun run build',
            installCommand: 'bun install'
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
  
  await fs.writeFile(outputPath, JSON.stringify(sampleConfig, null, 2));
  console.log(chalk.green(`✅ Sample ${language} configuration generated: ${outputPath}`));
}

async function detectLanguage(projectPath: string) {
  try {
    const result = await detectProjectCommands(projectPath);
    
    if (result.isValidProject && result.language) {
      console.log(chalk.green(`✅ Detected language: ${result.language}`));
      console.log(chalk.gray(`   Project type: ${result.language}`));
      console.log(chalk.gray(`   Config file found: ${result.hasConfigFile ? 'Yes' : 'No'}`));
      
      if (result.commands) {
        console.log(chalk.cyan('📋 Detected commands:'));
        console.log(chalk.gray(`   Install: ${result.commands.installCommand}`));
        console.log(chalk.gray(`   Build: ${result.commands.buildCommand}`));
        console.log(chalk.gray(`   Test: ${result.commands.testCommand}`));
      }
    } else {
      console.log(chalk.red('❌ Could not detect project language'));
      if (result.error) {
        console.log(chalk.red(`   Error: ${result.error}`));
      }
      process.exit(1);
    }
  } catch (error) {
    console.log(chalk.red('❌ Failed to detect language'));
    console.log(chalk.red(`   ${error}`));
    process.exit(1);
  }
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
  .option('--source-language <lang>', 'Override source repository language (typescript|rust|python)')
  .option('--testcase-language <lang>', 'Override testcase repository language (typescript|rust|python)')
  .option('--verify-signatures', 'Enable commit signature verification (default: false)')
  .option('--no-verify-signatures', 'Disable commit signature verification')
  .option('--contract-address <address>', 'GitIdentityRegistry contract address for key verification')
  .option('--fallback-to-github', 'Enable fallback to GitHub API for signature verification (default: false)')
  .option('--no-fallback-to-github', 'Disable fallback to GitHub API')
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
  .command('detect')
  .description('Detect project language and commands from a directory')
  .option('-p, --path <path>', 'Path to project directory', '.')
  .action(async (options) => {
    await detectLanguage(options.path);
  });

program
  .command('generate-config')
  .description('Generate a sample configuration file')
  .option('-o, --output <path>', 'Output path for the configuration file', './config.sample.json')
  .option('-l, --language <lang>', 'Project language (typescript|rust|python)', 'typescript')
  .action(async (options) => {
    await generateSampleConfig(options.output, options.language as ProjectLanguage);
  });

program.parse();
