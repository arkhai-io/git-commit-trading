import { spawn, type SpawnOptions } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';
import type { Config } from './types.js';

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

export async function executeCommand(
  command: string,
  args: string[],
  options: SpawnOptions & { timeout?: number } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const { timeout = 30000, ...spawnOptions } = options;
    const child = spawn(command, args, {
      stdio: 'pipe',
      ...spawnOptions,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: any) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: any) => {
      stderr += data.toString();
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
 * @param fullCommand - Full command like "npm run test" or "bun install"
 * @returns {command: string, args: string[]}
 */
export function parseCommand(fullCommand: string): { command: string; args: string[] } {
  const parts = fullCommand.trim().split(/\s+/);
  
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
