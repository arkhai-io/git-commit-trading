import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import chalk from 'chalk';
import type { Config, ExecutionResult, TestResult, RepositoryConfig } from './types.js';
import { Logger, executeCommand, ensureDirectory, removeDirectory, copyDirectory, parseCommand, validateCommitHash, normalizeCommitHash, downloadAndExtractArchive } from './utils.js';

export class TestExecutor {
  private config: Config;
  private workingDir: string;
  private sourceDir: string;
  private testcaseDir: string;
  private mergedDir: string;

  constructor(config: Config) {
    this.config = config;
    this.workingDir = path.resolve(config.execution.tempDirectory, `execution-${uuidv4()}`);
    this.sourceDir = path.join(this.workingDir, 'source');
    this.testcaseDir = path.join(this.workingDir, 'testcase');
    this.mergedDir = path.join(this.workingDir, 'merged');
  }

  async execute(): Promise<ExecutionResult> {
    const result: ExecutionResult = {
      sourceCloned: false,
      testcaseCloned: false,
      dependenciesInstalled: false,
      testsExecuted: false,
      testResult: {
        success: false,
        output: '',
        duration: 0,
        timestamp: new Date(),
      },
      cleanup: false,
      workingDirectory: this.workingDir,
    };

    try {
      // Create working directory
      await ensureDirectory(this.workingDir);
      
      // Step 1: Clone source repository (Bob's solution)
      console.log(chalk.cyan('Cloning solution repo...'));
      const sourceRepoInfo = this.config.repositories.source.commitHash && this.config.repositories.source.commitHash.trim() !== '' 
        ? `${this.config.repositories.source.url} (commit: ${this.config.repositories.source.commitHash})`
        : `${this.config.repositories.source.url} (branch: ${this.config.repositories.source.branch})`;
      console.log(chalk.gray(`Source: ${sourceRepoInfo}`));
      await this.cloneRepository(this.config.repositories.source, this.sourceDir);
      result.sourceCloned = true;

      // Step 2: Clone testcase repository (Alice's tests)
      console.log(chalk.cyan('Cloning test repo...'));
      const testcaseRepoInfo = this.config.repositories.testcase.commitHash && this.config.repositories.testcase.commitHash.trim() !== '' 
        ? `${this.config.repositories.testcase.url} (commit: ${this.config.repositories.testcase.commitHash})`
        : `${this.config.repositories.testcase.url} (branch: ${this.config.repositories.testcase.branch})`;
      console.log(chalk.gray(`Testcase: ${testcaseRepoInfo}`));
      await this.cloneRepository(this.config.repositories.testcase, this.testcaseDir);
      result.testcaseCloned = true;

      // Step 3: Merge Bob's solution into Alice's test structure
      console.log(chalk.cyan('Merging solution with tests...'));
      await this.mergeTestcases();

      // Step 4: Install dependencies
      console.log(chalk.cyan('Installing dependencies...'));
      await this.installDependencies();
      result.dependenciesInstalled = true;

      // Step 5: Build source if needed (use Alice's build command if available)
      const buildCommand = this.config.repositories.testcase.buildCommand || this.config.repositories.source.buildCommand;
      if (buildCommand) {
        console.log(chalk.cyan('Building project...'));
        await this.buildSource();
      }

      // Step 6: Run tests
      console.log(chalk.cyan('Running tests...'));
      result.testResult = await this.runTests();
      result.testsExecuted = true;

    } catch (error) {
      result.testResult.error = error instanceof Error ? error.message : String(error);
    } finally {
      // Cleanup if configured
      if (this.config.execution.cleanupAfterExecution) {
        console.log(chalk.cyan('Cleaning up...'));
        try {
          await this.cleanup();
          result.cleanup = true;
        } catch (error) {
          result.cleanup = false;
        }
      } else {
        result.cleanup = true;
      }
    }

    return result;
  }

  private async cloneRepository(repo: RepositoryConfig, targetDir: string): Promise<void> {
    let downloadUrl: string;
    const host = repo.url;

    // Case 1: If host contains .git suffix, remove it and create GitHub archive link
    if (host.endsWith('.git')) {
      if (host.includes('github.com')) {
        // Extract owner/repo from git URL
        const gitUrlMatch = host.match(/github\.com[\/:]([^\/]+)\/([^\/]+)\.git$/);
        if (gitUrlMatch && repo.commitHash) {
          const [, owner, repoName] = gitUrlMatch;
          downloadUrl = `https://github.com/${owner}/${repoName}/archive/${repo.commitHash}.tar.gz`;
          Logger.step(`Converted git URL to archive URL: ${downloadUrl}`);
        } else {
          throw new Error(`Cannot construct archive URL from ${host}. Please provide commitHash.`);
        }
      } else {
        throw new Error(`Git URLs are only supported for GitHub repositories. Use direct download links for other hosts.`);
      }
    }
    // Case 2: If host doesn't contain .git suffix but is GitHub (and not already an archive), create download link
    else if (host.includes('github.com') && !host.includes('/archive/') && !host.endsWith('.tar.gz')) {
      const githubMatch = host.match(/github\.com[\/:]([^\/]+)\/([^\/]+)\/?$/);
      if (githubMatch && repo.commitHash) {
        const [, owner, repoName] = githubMatch;
        downloadUrl = `https://github.com/${owner}/${repoName}/archive/${repo.commitHash}.tar.gz`;
        Logger.step(`Constructed GitHub archive URL: ${downloadUrl}`);
      } else {
        throw new Error(`Cannot construct archive URL from ${host}. Please provide commitHash.`);
      }
    }
    // Case 3: If host contains other link (not GitHub) OR is already a direct archive URL, download directly
    else {
      downloadUrl = host;
      Logger.step(`Using direct download URL: ${downloadUrl}`);
    }

    // Validate commit hash format if algorithm is specified
    if (repo.commitHash && repo.commitAlgo) {
      const normalizedHash = normalizeCommitHash(repo.commitHash);
      if (!validateCommitHash(normalizedHash, repo.commitAlgo)) {
        throw new Error(`Invalid ${repo.commitAlgo.toUpperCase()} commit hash format: ${repo.commitHash}`);
      }
      Logger.step(`Validated ${repo.commitAlgo.toUpperCase()} commit hash: ${normalizedHash}`);
    }

    // Download and extract the archive
    Logger.step(`Downloading and extracting archive from ${downloadUrl}...`);
    await ensureDirectory(targetDir);
    await downloadAndExtractArchive(downloadUrl, targetDir);
    Logger.success('Archive downloaded and extracted successfully');
  }

  private async mergeTestcases(): Promise<void> {
    // In this scenario:
    // - testcase repo (Alice) has the test structure with empty src/
    // - source repo (Bob) has the implementation in src/
    // We need to copy Alice's structure first, then merge Bob's src/ into Alice's src/
    
    Logger.step('Setting up Alice\'s test structure...');
    await copyDirectory(this.testcaseDir, this.mergedDir);
    
    Logger.step('Merging Bob\'s solution into Alice\'s src directory...');
    const bobSrcDir = path.join(this.sourceDir, 'src');
    const aliceSrcDir = path.join(this.mergedDir, 'src');
    
    // Ensure Alice's src directory exists
    await ensureDirectory(aliceSrcDir);
    
    // Copy Bob's src content into Alice's src
    try {
      await copyDirectory(bobSrcDir, aliceSrcDir);
      Logger.success('Successfully merged Bob\'s solution code');
    } catch (error) {
      Logger.warning(`Could not copy from ${bobSrcDir}: ${error}`);
      // If Bob doesn't have a src directory, try copying the entire repo content
      Logger.step('Trying to copy all of Bob\'s content to src/...');
      const entries = await import('fs').then(fs => fs.promises.readdir(this.sourceDir, { withFileTypes: true }));
      
      for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        
        const srcPath = path.join(this.sourceDir, entry.name);
        const destPath = path.join(aliceSrcDir, entry.name);
        
        if (entry.isDirectory()) {
          await copyDirectory(srcPath, destPath);
        } else {
          await import('fs').then(fs => fs.promises.copyFile(srcPath, destPath));
        }
      }
    }
  }

  private async installDependencies(): Promise<void> {
    // Install dependencies for the merged project (Alice's install command)
    const installCommand = this.config.repositories.testcase.installCommand || 'npm install';
    
    Logger.step(`Installing dependencies using: ${installCommand}`);
    
    const { command, args } = parseCommand(installCommand);
    
    const result = await executeCommand(
      command,
      args,
      {
        cwd: this.mergedDir,
        timeout: this.config.execution.timeout,
      }
    );

    if (result.exitCode !== 0) {
      throw new Error(`Dependency installation failed: ${result.stderr}`);
    }
    
    Logger.success('Dependencies installed successfully');
  }

  private async buildSource(): Promise<void> {
    // Try Alice's build command first, then Bob's
    const buildCommand = this.config.repositories.testcase.buildCommand || this.config.repositories.source.buildCommand;
    if (!buildCommand) {
      return;
    }

    Logger.step(`Building project using: ${buildCommand}`);
    
    const { command, args } = parseCommand(buildCommand);
    
    const result = await executeCommand(
      command,
      args,
      {
        cwd: this.mergedDir,
        timeout: this.config.execution.timeout,
      }
    );

    if (result.exitCode !== 0) {
      throw new Error(`Build failed: ${result.stderr}`);
    }
  }

  private async runTests(): Promise<TestResult> {
    const startTime = Date.now();
    
    try {
      // Use Alice's test command or fall back to default
      const testCommand = this.config.repositories.testcase.testCommand || this.config.repositories.source.testCommand || 'npm test';
      
      Logger.step(`Running tests with command: ${testCommand}`);

      const { command, args } = parseCommand(testCommand);

      const result = await executeCommand(
        command,
        args,
        {
          cwd: this.mergedDir,
          timeout: this.config.execution.timeout,
        }
      );

      const duration = Date.now() - startTime;

      return {
        success: result.exitCode === 0,
        output: result.stdout,
        error: result.exitCode !== 0 ? result.stderr : undefined,
        duration,
        timestamp: new Date(),
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
        duration,
        timestamp: new Date(),
      };
    }
  }

  private async cleanup(): Promise<void> {
    // Remove the entire temp directory instead of just the working subdirectory
    const tempDirectory = path.resolve(this.config.execution.tempDirectory);
    await removeDirectory(tempDirectory);
  }

  getWorkingDirectory(): string {
    return this.workingDir;
  }
}
