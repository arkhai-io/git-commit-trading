import { spawn, type SpawnOptions } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';
import type { Config } from './types.js';
import { exec } from 'child_process';


export async function loadConfig(configPath: string): Promise<Config> {
  try {
    const configContent = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(configContent);
  } catch (error) {
    throw new Error(`Failed to load config from ${configPath}: ${error}`);
  }
}

export class Logger {
  static info(message: string) {
    console.log(chalk.blue('ℹ'), message);
  }

  static success(message: string) {
    console.log(chalk.green('✓'), message);
  }

  static error(message: string) {
    console.log(chalk.red('✗'), message);
  }

  static warning(message: string) {
    console.log(chalk.yellow('⚠'), message);
  }

  static step(message: string) {
    console.log(chalk.cyan('→'), message);
  }
}

/**
 * Check if bash is available on the system
 */
let bashAvailableCache: boolean | null = null;
export async function isBashAvailable(): Promise<boolean> {
  if (bashAvailableCache !== null) {
    return bashAvailableCache;
  }
  
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec('bash --version', (error: any) => {
      bashAvailableCache = !error;
      resolve(bashAvailableCache);
    });
  });
}

export async function executeCommand(
  command: string,
  args: string[],
  options: SpawnOptions & { timeout?: number } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const { timeout = 30000, ...spawnOptions } = options;
    
    const cwd = spawnOptions.cwd || process.cwd();
    const currentPath = process.env.PATH || '';
    const debugMode = process.env.DEBUG === 'true';
    
    // Only add node_modules/.bin to PATH for Node.js/npm/yarn/pnpm/bun commands
    // Don't pollute PATH for Python, Rust, or other language commands
    const isNodeCommand = ['npm', 'node', 'npx', 'yarn', 'pnpm', 'bun', 'tsc', 'jest', 'mocha', 'vitest'].includes(command);
    const isShellWithNodeCommand = (command === 'sh' || command === 'bash') && 
                                   args.some(arg => arg.includes('npm') || arg.includes('yarn') || 
                                                   arg.includes('pnpm') || arg.includes('bun') ||
                                                   arg.includes('node_modules'));
    
    let enhancedPath = currentPath;
    
    if (isNodeCommand || isShellWithNodeCommand) {
      // Add node_modules/.bin for Node.js commands
      const nodeModulesBin = path.join(cwd.toString(), 'node_modules', '.bin');
      const pathEntries = currentPath.split(path.delimiter);
      const isAlreadyInPath = pathEntries.some(entry => entry === nodeModulesBin);
      
      enhancedPath = isAlreadyInPath 
        ? currentPath 
        : `${nodeModulesBin}${path.delimiter}${currentPath}`;
      
      if (debugMode) {
        if (isAlreadyInPath) {
          console.log(chalk.gray(`[EXEC] node_modules/.bin already in PATH: ${nodeModulesBin}`));
        } else {
          console.log(chalk.gray(`[EXEC] node_modules/.bin added to PATH: ${nodeModulesBin}`));
        }
      }
    } else if (debugMode) {
      console.log(chalk.gray(`[EXEC] Skipping node_modules/.bin (not a Node.js command)`));
    }
    
    // Always log command execution details for debugging
    if (debugMode) {
      console.log(chalk.gray(`[EXEC] Running: ${command} ${args.join(' ')}`));
      console.log(chalk.gray(`[EXEC] Working directory: ${cwd}`));
    }
    
    // Try to find where the binary actually is
    try {
      const { execSync } = require('child_process');
      const whichCommand = process.platform === 'win32' ? 'where' : 'which';
      
      // For npm/node commands, show where they're found
      if (['npm', 'node', 'npx', 'tsc', 'yarn', 'pnpm', 'bun'].includes(command)) {
        try {
          const binaryPath = execSync(`${whichCommand} ${command}`, { 
            encoding: 'utf8',
            env: { ...process.env, PATH: enhancedPath }
          }).trim();
          if (debugMode) {
            console.log(chalk.gray(`[EXEC] Binary found at: ${binaryPath}`));
          }
        } catch (e) {
          console.log(chalk.yellow(`[EXEC] Warning: ${command} not found in PATH`));
        }
      }
      
      // For shell commands (sh, cmd), just note we're using shell
      if (command === 'sh' || command === 'cmd') {
        console.log(chalk.gray(`[EXEC] Using shell to execute compound command`));
      }
    } catch (e) {
      // Ignore errors in binary detection
    }
    
    // Debug: Additional verbose info
    if (debugMode) {
      console.log(chalk.gray(`[DEBUG] Full PATH: ${enhancedPath.substring(0, 200)}...`));
    }
    
    const child = spawn(command, args, {
      stdio: 'pipe',
      ...spawnOptions,
      env: {
        ...process.env,
        ...spawnOptions.env,
        PATH: enhancedPath,
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: any) => {
      const text = data.toString();
      stdout += text;
      if (debugMode) {
        process.stdout.write(chalk.gray('[STDOUT] ') + text);
      }
    });

    child.stderr?.on('data', (data: any) => {
      const text = data.toString();
      stderr += text;
      if (debugMode) {
        process.stderr.write(chalk.yellow('[STDERR] ') + text);
      }
    });

    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Command timed out after ${timeout}ms: ${command} ${args.join(' ')}`));
    }, timeout);

    child.on('close', (code: number | null) => {
      clearTimeout(timeoutId);
      resolve({
        stdout,
        stderr,
        exitCode: code || 0,
      });
    });

    child.on('error', (error: Error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

export async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

export async function removeDirectory(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    Logger.warning(`Failed to remove directory ${dirPath}: ${error}`);
  }
}

export async function copyDirectory(src: string, dest: string): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true });
  
  await ensureDirectory(dest);
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

export function getPackageManagerCommands(packageManager: string) {
  const commands = {
    npm: {
      install: ['npm', 'install'],
      run: (script: string) => ['npm', 'run', script],
      test: ['npm', 'test'],
    },
    yarn: {
      install: ['yarn', 'install'],
      run: (script: string) => ['yarn', script],
      test: ['yarn', 'test'],
    },
    pnpm: {
      install: ['pnpm', 'install'],
      run: (script: string) => ['pnpm', 'run', script],
      test: ['pnpm', 'test'],
    },
    bun: {
      install: ['bun', 'install'],
      run: (script: string) => ['bun', 'run', script],
      test: ['bun', 'test'],
    },
  };

  return commands[packageManager as keyof typeof commands] || commands.npm;
}

/**
 * Parse a full command string into command and arguments
 * @param fullCommand - Full command like "npm run test" or "bun install" or compound commands with &&, ||, ;
 * @returns {command: string, args: string[]}
 */
export function parseCommand(fullCommand: string): { command: string; args: string[] } {
  const trimmedCommand = fullCommand.trim();
  
  if (!trimmedCommand) {
    throw new Error('Invalid command: empty command string');
  }
  
  // Check if this is a compound command (contains &&, ||, ;, or |)
  const hasShellOperators = /[;&|]/.test(trimmedCommand);
  
  if (hasShellOperators) {
    // For compound commands, we need to run them in a shell
    const isWindows = process.platform === 'win32';
    
    if (isWindows) {
      return {
        command: 'cmd',
        args: ['/c', trimmedCommand]
      };
    } else {
      // Check if command contains Python venv or other bash-specific features
      // Use bash for better compatibility with Python virtual environments
      const needsBash = trimmedCommand.includes('venv/bin/') || 
                       trimmedCommand.includes('source ') ||
                       trimmedCommand.includes('pipenv ') ||
                       trimmedCommand.includes('python3 -m venv');
      
      if (needsBash) {
        // Use bash for Python commands (venv paths work fine in both sh and bash)
        // But bash has better compatibility overall
        return {
          command: 'bash',
          args: ['-c', trimmedCommand]
        };
      } else {
        return {
          command: 'sh',
          args: ['-c', trimmedCommand]
        };
      }
    }
  }
  
  // For simple commands, split by whitespace
  const parts = trimmedCommand.split(/\s+/);
  
  if (!parts[0]) {
    throw new Error('Invalid command: empty command string');
  }
  
  return {
    command: parts[0],
    args: parts.slice(1)
  };
}

// Commit hash validation utilities
export function validateCommitHash(commitHash: string, algorithm: 'sha256' | 'md5' | 'sha1' = 'sha1'): boolean {
  if (!commitHash || commitHash.trim() === '') {
    return false;
  }

  const trimmedHash = commitHash.trim();

  switch (algorithm) {
    case 'sha256':
      // SHA-256 produces 64 hexadecimal characters
      return /^[a-f0-9]{64}$/i.test(trimmedHash);
    case 'md5':
      // MD5 produces 32 hexadecimal characters
      return /^[a-f0-9]{32}$/i.test(trimmedHash);
    case 'sha1':
      // SHA-1 produces 40 hexadecimal characters (standard Git format)
      return /^[a-f0-9]{40}$/i.test(trimmedHash);
    default:
      return false;
  }
}

export function getCommitHashLength(algorithm: 'sha256' | 'md5' | 'sha1'): number {
  switch (algorithm) {
    case 'sha256':
      return 64;
    case 'md5':
      return 32;
    case 'sha1':
      return 40;
    default:
      return 40; // Default Git SHA-1 length
  }
}

export function normalizeCommitHash(commitHash: string): string {
  return commitHash.trim().toLowerCase();
}


/**
 * Clone a git repository and checkout a specific commit.
 * @param gitUrl The git repository URL (e.g. https://github.com/user/repo.git)
 * @param targetDir The directory to clone the repository into
 * @param commitHash The specific commit hash to checkout (optional)
 */
export async function cloneGitRepository(gitUrl: string, targetDir: string, commitHash?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // First, clone the repository
    const cloneCmd = `git clone "${gitUrl}" "${targetDir}"`;
    exec(cloneCmd, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Failed to clone repository: ${stderr || error.message}`));
        return;
      }

      // If no commit hash is specified, we're done
      if (!commitHash) {
        resolve();
        return;
      }

      // Checkout the specific commit
      const checkoutCmd = `cd "${targetDir}" && git checkout "${commitHash}"`;
      exec(checkoutCmd, (checkoutError, checkoutStdout, checkoutStderr) => {
        if (checkoutError) {
          reject(new Error(`Failed to checkout commit ${commitHash}: ${checkoutStderr || checkoutError.message}`));
        } else {
          resolve();
        }
      });
    });
  });
}
