import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import chalk from 'chalk';
import type { Config, ExecutionResult, TestResult, RepositoryConfig, ProjectLanguage } from './types.js';
import { Logger, executeCommand, ensureDirectory, removeDirectory, copyDirectory, parseCommand, validateCommitHash, normalizeCommitHash, cloneGitRepository } from './utils.js';
import { detectProjectCommands, detectPackageManager, updateCommandsForPackageManager, type ProjectCommands } from './projectDetection.js';
import { GitCommitVerifier } from '../utils/gitVerification.js';

export class TestExecutor {
  private config: Config;
  private workingDir: string;
  private sourceDir: string;
  private testcaseDir: string;
  private mergedDir: string;
  private detectedLanguage: ProjectLanguage | null = null;
  private projectCommands: ProjectCommands | null = null;
  private gitVerifier: GitCommitVerifier | null = null;

  constructor(config: Config) {
    this.config = config;
    this.workingDir = path.resolve(config.execution.tempDirectory, `execution-${uuidv4()}`);
    this.sourceDir = path.join(this.workingDir, 'source');
    this.testcaseDir = path.join(this.workingDir, 'testcase');
    this.mergedDir = path.join(this.workingDir, 'merged');
    
    // Initialize git verifier if signature verification is enabled
    if (config.execution.verifyCommitSignatures) {
      this.gitVerifier = new GitCommitVerifier({});
    }
  }

  async execute(): Promise<ExecutionResult> {
    const result: ExecutionResult = {
      sourceCloned: false,
      testcaseCloned: false,
      sourceSignatureVerified: undefined,
      testcaseSignatureVerified: undefined,
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
      result.sourceSignatureVerified = await this.cloneRepository(this.config.repositories.source, this.sourceDir, 'source');
      result.sourceCloned = true;

      // Step 2: Clone testcase repository (Alice's tests)
      console.log(chalk.cyan('Cloning test repo...'));
      const testcaseRepoInfo = this.config.repositories.testcase.commitHash && this.config.repositories.testcase.commitHash.trim() !== '' 
        ? `${this.config.repositories.testcase.url} (commit: ${this.config.repositories.testcase.commitHash})`
        : `${this.config.repositories.testcase.url} (branch: ${this.config.repositories.testcase.branch})`;
      console.log(chalk.gray(`Testcase: ${testcaseRepoInfo}`));
      result.testcaseSignatureVerified = await this.cloneRepository(this.config.repositories.testcase, this.testcaseDir, 'testcase');
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

  private async cloneRepository(repo: RepositoryConfig, targetDir: string, repoType: 'source' | 'testcase' = 'source'): Promise<boolean> {
    const gitUrl = repo.url;

    // Validate commit hash format if algorithm is specified
    if (repo.commitHash && repo.commitAlgo) {
      const normalizedHash = normalizeCommitHash(repo.commitHash);
      if (!validateCommitHash(normalizedHash, repo.commitAlgo)) {
        throw new Error(`Invalid ${repo.commitAlgo.toUpperCase()} commit hash format: ${repo.commitHash}`);
      }
      Logger.step(`Validated ${repo.commitAlgo.toUpperCase()} commit hash: ${normalizedHash}`);
    }

    // Clone the repository and checkout specific commit
    Logger.step(`Cloning repository from ${gitUrl}...`);
    await ensureDirectory(targetDir);
    await cloneGitRepository(gitUrl, targetDir, repo.commitHash);
    Logger.success('Repository cloned successfully');

    // Verify commit signature if enabled
    let signatureVerified = false;
    if (this.config.execution.verifyCommitSignatures && this.gitVerifier && repo.commitHash) {
      Logger.step(`Verifying commit signature for ${repo.commitHash}...`);
      try {
        const verification = await this.gitVerifier.verifyCommitInDirectory(targetDir, repo.commitHash);
        signatureVerified = verification.isValid;
        
        if (verification.isValid) {
          Logger.success(`✅ Commit signature verified for ${repoType} repository`);
          Logger.step(`Signer: ${verification.keyFingerprint || 'Unknown'}`);
        } else {
          Logger.error(`❌ Commit signature verification failed for ${repoType} repository`);
          Logger.error(`Reason: ${verification.error || 'Unknown error'}`);
          
          // Fail the process if signature verification is required
          throw new Error(`Commit signature verification failed for ${repoType}: ${verification.error}`);
        }
      } catch (error) {
        Logger.error(`❌ Error during signature verification for ${repoType}: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    }

    return signatureVerified;
  }

  private async mergeTestcases(): Promise<void> {
    // In this scenario:
    // - testcase repo (Alice) has the test structure with empty src/
    // - source repo (Bob) has the implementation in src/
    // We need to copy Alice's structure first, then merge Bob's src/ into Alice's src/
    
    Logger.step('Setting up Alice\'s test structure...');
    await copyDirectory(this.testcaseDir, this.mergedDir);
    
    Logger.step('Detecting language-specific merge strategy...');
    const mergeStrategy = await this.getLanguageSpecificMergeStrategy();
    
    Logger.step('Merging Bob\'s solution into Alice\'s project structure...');
    
    // Determine source and target directories
    const bobSourceDir = mergeStrategy.sourceSubDir 
      ? path.join(this.sourceDir, mergeStrategy.sourceSubDir)
      : this.sourceDir;
    
    const aliceTargetDir = mergeStrategy.targetSubDir
      ? path.join(this.mergedDir, mergeStrategy.targetSubDir)
      : this.mergedDir;
    
    // Ensure Alice's target directory exists if needed
    if (mergeStrategy.shouldCreateTarget) {
      await ensureDirectory(aliceTargetDir);
    }
    
    // Copy Bob's source content into Alice's target
    try {
      await copyDirectory(bobSourceDir, aliceTargetDir);
      Logger.success(`Successfully merged Bob's ${this.detectedLanguage || 'code'} solution`);
    } catch (error) {
      Logger.warning(`Could not copy from ${bobSourceDir}: ${error}`);
      // If Bob doesn't have the expected structure, try copying the entire repo content
      Logger.step('Trying to copy all of Bob\'s content to target directory...');
      const entries = await import('fs').then(fs => fs.promises.readdir(this.sourceDir, { withFileTypes: true }));
      
      for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'target' || entry.name === '__pycache__') continue;
        
        const srcPath = path.join(this.sourceDir, entry.name);
        const destPath = path.join(aliceTargetDir, entry.name);
        
        if (entry.isDirectory()) {
          await copyDirectory(srcPath, destPath);
        } else {
          await import('fs').then(fs => fs.promises.copyFile(srcPath, destPath));
        }
      }
    }
  }

  private async installDependencies(): Promise<void> {
    let installCommand: string;
    
    // First try to get install command from config (Alice's testcase repo)
    if (this.config.repositories.testcase.installCommand) {
      installCommand = this.config.repositories.testcase.installCommand;
      Logger.step(`Using configured install command: ${installCommand}`);
    } else {
      // Fallback to auto-detection
      Logger.step('Auto-detecting install command from merged project...');
      const detectedCommands = await detectProjectCommands(this.mergedDir);
      if (!detectedCommands.isValidProject || !detectedCommands.commands) {
        throw new Error(`Failed to detect project commands: ${detectedCommands.error || 'Not a valid project'}`);
      }
      
      this.detectedLanguage = detectedCommands.language;
      this.projectCommands = detectedCommands.commands;
      
      installCommand = detectedCommands.commands.installCommand;
      
      // For TypeScript projects, update commands based on package manager
      if (detectedCommands.language === 'typescript') {
        const packageManager = await detectPackageManager(this.mergedDir);
        const updatedCommands = updateCommandsForPackageManager(
          detectedCommands.commands as any, 
          packageManager
        );
        installCommand = updatedCommands.installCommand;
        this.projectCommands = updatedCommands;
      }
      
      Logger.step(`Auto-detected ${detectedCommands.language} project with install command: ${installCommand}`);
    }
    
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
    let buildCommand: string | undefined;
    
    // Try Alice's build command first, then Bob's
    buildCommand = this.config.repositories.testcase.buildCommand || this.config.repositories.source.buildCommand;
    
    if (!buildCommand) {
      // Use cached detection result if available
      if (this.projectCommands) {
        buildCommand = this.projectCommands.buildCommand;
        Logger.step(`Using cached build command: ${buildCommand}`);
      } else {
        // Fallback to auto-detection
        Logger.step('Auto-detecting build command from merged project...');
        const detectedCommands = await detectProjectCommands(this.mergedDir);
        if (!detectedCommands.isValidProject || !detectedCommands.commands) {
          Logger.warning('No build command detected, skipping build step');
          return;
        }
        buildCommand = detectedCommands.commands.buildCommand;
        this.detectedLanguage = detectedCommands.language;
        this.projectCommands = detectedCommands.commands;
      }
      
      if (!buildCommand || buildCommand.includes('No build command')) {
        Logger.warning('No build command available, skipping build step');
        return;
      }
      Logger.step(`Auto-detected build command: ${buildCommand}`);
    } else {
      Logger.step(`Using configured build command: ${buildCommand}`);
    }

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
    
    Logger.success('Build completed successfully');
  }

  private async runTests(): Promise<TestResult> {
    const startTime = Date.now();
    
    try {
      let testCommand: string | undefined;
      
      // Use Alice's test command first, then Bob's
      testCommand = this.config.repositories.testcase.testCommand || this.config.repositories.source.testCommand;
      
      if (!testCommand) {
        // Use cached detection result if available
        if (this.projectCommands) {
          testCommand = this.projectCommands.testCommand;
          Logger.step(`Using previous founded test command: ${testCommand}`);
        } else {
          // Fallback to auto-detection
          Logger.step('Auto-detecting test command from merged project...');
          const detectedCommands = await detectProjectCommands(this.mergedDir);
          if (!detectedCommands.isValidProject || !detectedCommands.commands) {
            throw new Error(`Failed to detect project commands: ${detectedCommands.error || 'Not a valid project'}`);
          }
          testCommand = detectedCommands.commands.testCommand;
          this.detectedLanguage = detectedCommands.language;
          this.projectCommands = detectedCommands.commands;
          Logger.step(`Auto-detected ${detectedCommands.language} project with test command: ${testCommand}`);
        }
      } else {
        Logger.step(`Using configured test command: ${testCommand}`);
      }

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

  getDetectedLanguage(): ProjectLanguage | null {
    return this.detectedLanguage;
  }

  getProjectCommands(): ProjectCommands | null {
    return this.projectCommands;
  }

  /**
   * Get language-specific merge strategy
   */
  private async getLanguageSpecificMergeStrategy(): Promise<{
    sourceSubDir?: string;
    targetSubDir?: string;
    shouldCreateTarget?: boolean;
  }> {
    // Detect language if not already detected
    if (!this.detectedLanguage) {
      const testcaseDetection = await detectProjectCommands(this.testcaseDir);
      if (testcaseDetection.isValidProject) {
        this.detectedLanguage = testcaseDetection.language;
      }
    }

    switch (this.detectedLanguage) {
      case 'typescript':
        return {
          sourceSubDir: 'src',
          targetSubDir: 'src',
          shouldCreateTarget: true
        };
      case 'rust':
        return {
          sourceSubDir: 'src',
          targetSubDir: 'src',
          shouldCreateTarget: true
        };
      case 'python':
        return {
          // Python projects might have various structures
          // Try to detect if it's a package or simple scripts
          sourceSubDir: await this.detectPythonSourceStructure(),
          targetSubDir: 'src', // Standard target
          shouldCreateTarget: true
        };
      default:
        return {
          sourceSubDir: 'src',
          targetSubDir: 'src',
          shouldCreateTarget: true
        };
    }
  }

  private async detectPythonSourceStructure(): Promise<string | undefined> {
    try {
      const entries = await import('fs').then(fs => fs.promises.readdir(this.sourceDir, { withFileTypes: true }));
      
      // Look for common Python source patterns
      const patterns = ['src', 'lib', '*.py files in root'];
      
      // Check if there's a src directory
      if (entries.some(entry => entry.isDirectory() && entry.name === 'src')) {
        return 'src';
      }
      
      // Check if there are Python files in root
      if (entries.some(entry => entry.isFile() && entry.name.endsWith('.py'))) {
        return undefined; // Use root directory
      }
      
      // Look for a package directory (directory with __init__.py)
      for (const entry of entries) {
        if (entry.isDirectory()) {
          try {
            const packageDir = path.join(this.sourceDir, entry.name);
            await import('fs').then(fs => fs.promises.access(path.join(packageDir, '__init__.py')));
            return entry.name; // Found a package directory
          } catch {
            // Not a package directory, continue
          }
        }
      }
      
      return 'src'; // Default fallback
    } catch {
      return 'src'; // Error fallback
    }
  }
}
