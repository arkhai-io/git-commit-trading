import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';
import type { ExecuteTestsOptions, ExecuteTestsResult, Framework, RepoRef } from './types.js';
import { cloneGitRepository, removeDirectory, ensureDirectory, Logger } from './utils.js';
import { defaultFrameworks, readCustomDockerfile } from './frameworks/index.js';

const execAsync = promisify(exec);

/**
 * Execute tests by cloning repositories, detecting framework, and running in Docker.
 *
 * @param options - Test execution options
 * @returns Test execution result
 */
export async function executeTests(options: ExecuteTestsOptions): Promise<ExecuteTestsResult> {
  const {
    tests,
    source,
    frameworks = defaultFrameworks,
    timeout = 300000,
    cleanup = true
  } = options;

  const workDir = `/tmp/git-test-${Date.now()}`;
  const testsDir = path.join(workDir, 'test-repo');
  const sourceDir = path.join(workDir, 'source-repo');
  const startTime = Date.now();

  let detectedFramework: Framework | null = null;

  try {
    await ensureDirectory(workDir);

    // Step 1: Clone test repo (try hosts in order)
    console.log(chalk.cyan('Cloning test repo...'));
    await cloneWithFallback(tests, testsDir, 'test');

    // Step 2: Clone source repo (try hosts in order)
    console.log(chalk.cyan('Cloning source repo...'));
    await cloneWithFallback(source, sourceDir, 'source');

    // Step 3: Detect framework from test repo
    console.log(chalk.cyan('Detecting framework...'));
    const sortedFrameworks = [...frameworks].sort(
      (a, b) => a.detectionPriority - b.detectionPriority
    );

    for (const framework of sortedFrameworks) {
      const matches = await framework.detect(testsDir);
      if (matches) {
        detectedFramework = framework;
        console.log(chalk.green(`✅ Detected framework: ${framework.name}`));
        break;
      }
    }

    if (!detectedFramework) {
      throw new Error(
        'Could not detect framework. Please add a lock file or arkhai_tests.dockerfile to the test repository.'
      );
    }

    // Step 4: Write dockerfile and build/run container
    console.log(chalk.cyan('Building and running Docker container...'));

    // Get dockerfile content (special handling for custom dockerfile)
    let dockerfileContent: string;
    if (detectedFramework.name === 'custom') {
      dockerfileContent = await readCustomDockerfile(testsDir);
    } else {
      dockerfileContent = detectedFramework.dockerfile;
    }

    const dockerfilePath = path.join(workDir, 'Dockerfile');
    await fs.writeFile(dockerfilePath, dockerfileContent);

    const { stdout, stderr, exitCode } = await buildAndRunDocker(workDir, timeout);
    const duration = Date.now() - startTime;

    // Step 5: Parse test output
    const combinedOutput = stdout + '\n' + stderr;
    const success = detectedFramework.parseTests(combinedOutput, exitCode);

    console.log(success
      ? chalk.green('✅ Tests passed')
      : chalk.red('❌ Tests failed')
    );

    return {
      success,
      output: combinedOutput,
      error: success ? undefined : stderr || 'Tests failed',
      frameworkUsed: detectedFramework.name,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.log(chalk.red(`❌ Error: ${errorMessage}`));

    return {
      success: false,
      output: '',
      error: errorMessage,
      frameworkUsed: detectedFramework?.name || 'unknown',
      duration,
    };
  } finally {
    // Step 6: Cleanup
    if (cleanup) {
      console.log(chalk.cyan('Cleaning up...'));
      await removeDirectory(workDir);
    } else {
      console.log(chalk.gray(`Working directory preserved at: ${workDir}`));
    }
  }
}

/**
 * Clone a repository, trying each host in order until one succeeds.
 */
async function cloneWithFallback(repo: RepoRef, targetDir: string, label: string): Promise<void> {
  let lastError: Error | null = null;

  for (let i = 0; i < repo.hosts.length; i++) {
    const host = repo.hosts[i]!;
    try {
      console.log(chalk.gray(`  Trying ${label} host ${i + 1}/${repo.hosts.length}: ${host}`));
      await cloneGitRepository(host, targetDir, repo.commit);
      console.log(chalk.green(`  ✅ Cloned ${label} repo from ${host}`));
      return;
    } catch (e) {
      lastError = e as Error;
      console.log(chalk.yellow(`  ⚠️ Failed to clone from ${host}: ${lastError.message}`));
      // Clean up failed clone attempt before trying next host
      await removeDirectory(targetDir);
    }
  }

  throw new Error(`Failed to clone ${label} repo from all ${repo.hosts.length} hosts: ${lastError?.message}`);
}

/**
 * Build a Docker image from the work directory and run tests.
 */
async function buildAndRunDocker(
  contextDir: string,
  timeout: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const imageName = `git-test:${Date.now()}`;
  const containerName = `git-test-${Date.now()}`;

  try {
    // Build image
    console.log(chalk.gray(`  Building image: ${imageName}`));
    const buildCmd = `docker build -t ${imageName} ${contextDir}`;

    try {
      await execAsync(buildCmd, { maxBuffer: 50 * 1024 * 1024 });
    } catch (buildError: any) {
      throw new Error(`Docker build failed: ${buildError.stderr || buildError.message}`);
    }

    console.log(chalk.green('  ✅ Image built successfully'));

    // Run container
    console.log(chalk.gray(`  Running container: ${containerName}`));

    try {
      // Run container with timeout
      const runCmd = `timeout ${Math.floor(timeout / 1000)} docker run --name ${containerName} ${imageName}`;
      await execAsync(runCmd, { maxBuffer: 50 * 1024 * 1024 }).catch(() => {
        // Container might exit with non-zero, that's expected for failed tests
      });
    } catch {
      // Ignore run errors - we'll get the exit code from inspect
    }

    // Get logs
    let stdout = '';
    let stderr = '';
    try {
      const logsResult = await execAsync(`docker logs ${containerName} 2>&1`, {
        maxBuffer: 50 * 1024 * 1024
      });
      stdout = logsResult.stdout;
    } catch (logsError: any) {
      stdout = logsError.stdout || '';
      stderr = logsError.stderr || '';
    }

    // Get exit code
    let exitCode = 1;
    try {
      const { stdout: exitCodeStr } = await execAsync(
        `docker inspect --format='{{.State.ExitCode}}' ${containerName}`
      );
      exitCode = parseInt(exitCodeStr.trim(), 10);
    } catch {
      // Default to 1 if we can't get exit code
    }

    console.log(chalk.gray(`  Container exited with code: ${exitCode}`));

    return { stdout, stderr, exitCode };
  } finally {
    // Cleanup container and image
    try {
      await execAsync(`docker rm -f ${containerName}`).catch(() => {});
      await execAsync(`docker rmi -f ${imageName}`).catch(() => {});
    } catch {
      // Ignore cleanup errors
    }
  }
}
