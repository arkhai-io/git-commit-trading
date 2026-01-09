import chalk from "chalk";
import { exec } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { verifyRepo } from "../crypto/index.js";
import { detectFramework } from "./frameworkDetection.js";
import { defaultFrameworks } from "./frameworks/index.js";
import type {
	Framework,
	RepoSpec,
	RunTestsOptions,
	TestResult,
	VerifyAndRunTestsOptions,
} from "./types.js";
import { ensureDirectory, removeDirectory } from "./utils.js";

const execAsync = promisify(exec);

// ============================================================================
// Primitive: cloneRepo
// ============================================================================

/**
 * Clone a git repository, trying multiple hosts in order.
 *
 * @param hosts - Git URLs to try in order (first success wins)
 * @param commit - Commit hash to checkout
 * @param targetDir - Directory to clone into (generates temp dir if not provided)
 * @returns Path to the cloned repository
 */
export async function cloneRepo(
	hosts: string[],
	commit: string,
	targetDir?: string,
): Promise<string> {
	const dir =
		targetDir ||
		`/tmp/git-clone-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	let lastError: Error | null = null;

	for (let i = 0; i < hosts.length; i++) {
		const host = hosts[i]!;
		try {
			console.log(
				chalk.gray(`  Trying host ${i + 1}/${hosts.length}: ${host}`),
			);
			await cloneGitRepository(host, dir, commit);
			console.log(chalk.green(`  ✅ Cloned from ${host}`));
			return dir;
		} catch (e) {
			lastError = e as Error;
			console.log(chalk.yellow(`  ⚠️ Failed: ${lastError.message}`));
			await removeDirectory(dir);
		}
	}

	throw new Error(
		`Failed to clone from all ${hosts.length} hosts: ${lastError?.message}`,
	);
}

async function cloneGitRepository(
	url: string,
	targetDir: string,
	commit: string,
): Promise<void> {
	await ensureDirectory(path.dirname(targetDir));

	// Clone with depth for efficiency, but enough to include the commit
	const cloneCmd = `git clone --depth 50 "${url}" "${targetDir}"`;
	await execAsync(cloneCmd, { timeout: 120000, maxBuffer: 50 * 1024 * 1024 });

	// Checkout specific commit
	const checkoutCmd = `git checkout ${commit}`;
	await execAsync(checkoutCmd, { cwd: targetDir, timeout: 30000 });
}

// ============================================================================
// Primitive: runTests
// ============================================================================

/**
 * Run tests given already-cloned test and source directories.
 * Detects framework, builds Docker container, and executes tests.
 *
 * @param testsDir - Path to cloned test repository
 * @param sourceDir - Path to cloned source repository
 * @param options - Optional configuration
 * @returns Test execution result
 */
export async function runTests(
	testsDir: string,
	sourceDir: string,
	options: RunTestsOptions = {},
): Promise<TestResult> {
	const { frameworks = defaultFrameworks, timeout = 300000 } = options;
	const startTime = Date.now();
	let detectedFramework: Framework | null = null;

	try {
		// Detect framework from test repo
		console.log(chalk.cyan("Detecting framework..."));
		const { framework, dockerfileContent } = await detectFramework(
			testsDir,
			frameworks,
		);
		detectedFramework = framework;
		console.log(chalk.green(`✅ Detected framework: ${framework.name}`));

		// Create temp work directory for Docker build
		const workDir = `/tmp/git-test-${Date.now()}`;
		await ensureDirectory(workDir);

		// Copy repos to work directory (Docker needs them in build context)
		await execAsync(`cp -r "${testsDir}" "${workDir}/test-repo"`);
		await execAsync(`cp -r "${sourceDir}" "${workDir}/source-repo"`);

		const dockerfilePath = path.join(workDir, "Dockerfile");
		await fs.writeFile(dockerfilePath, dockerfileContent);

		// Build and run
		console.log(chalk.cyan("Building and running Docker container..."));
		const { stdout, stderr, exitCode } = await buildAndRunDocker(
			workDir,
			timeout,
		);
		const duration = Date.now() - startTime;

		// Cleanup work directory
		await removeDirectory(workDir);

		// Parse test output
		const combinedOutput = stdout + "\n" + stderr;
		const success = detectedFramework.parseTests(combinedOutput, exitCode);

		console.log(
			success ? chalk.green("✅ Tests passed") : chalk.red("❌ Tests failed"),
		);

		return {
			success,
			output: combinedOutput,
			error: success ? undefined : stderr || "Tests failed",
			frameworkUsed: detectedFramework.name,
			duration,
		};
	} catch (error) {
		const duration = Date.now() - startTime;
		const errorMessage = error instanceof Error ? error.message : String(error);

		console.log(chalk.red(`❌ Error: ${errorMessage}`));

		return {
			success: false,
			output: "",
			error: errorMessage,
			frameworkUsed: detectedFramework?.name || "unknown",
			duration,
		};
	}
}

async function buildAndRunDocker(
	contextDir: string,
	timeout: number,
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
			throw new Error(
				`Docker build failed: ${buildError.stderr || buildError.message}`,
			);
		}

		console.log(chalk.green("  ✅ Image built successfully"));

		// Run container
		console.log(chalk.gray(`  Running container: ${containerName}`));

		try {
			const runCmd = `timeout ${Math.floor(timeout / 1000)} docker run --name ${containerName} ${imageName}`;
			await execAsync(runCmd, { maxBuffer: 50 * 1024 * 1024 }).catch(() => {});
		} catch {
			// Ignore - we'll get exit code from inspect
		}

		// Get logs
		let stdout = "";
		let stderr = "";
		try {
			const logsResult = await execAsync(`docker logs ${containerName} 2>&1`, {
				maxBuffer: 50 * 1024 * 1024,
			});
			stdout = logsResult.stdout;
		} catch (logsError: any) {
			stdout = logsError.stdout || "";
			stderr = logsError.stderr || "";
		}

		// Get exit code
		let exitCode = 1;
		try {
			const { stdout: exitCodeStr } = await execAsync(
				`docker inspect --format='{{.State.ExitCode}}' ${containerName}`,
			);
			exitCode = parseInt(exitCodeStr.trim(), 10);
		} catch {
			// Default to 1
		}

		console.log(chalk.gray(`  Container exited with code: ${exitCode}`));

		return { stdout, stderr, exitCode };
	} finally {
		// Cleanup
		try {
			await execAsync(`docker rm -f ${containerName}`).catch(() => {});
			await execAsync(`docker rmi -f ${imageName}`).catch(() => {});
		} catch {
			// Ignore cleanup errors
		}
	}
}

// ============================================================================
// Composition: verifyAndRunTests
// ============================================================================

/**
 * High-level function that composes cloning, verification, and test execution.
 * Handles cleanup automatically.
 *
 * @param options - Full options including repos, verification, and execution config
 * @returns Test execution result
 */
export async function verifyAndRunTests(
	options: VerifyAndRunTestsOptions,
): Promise<TestResult> {
	const { tests, source, frameworks, timeout, cleanup = true } = options;

	const clonedDirs: string[] = [];
	const startTime = Date.now();

	try {
		// Clone test repo
		console.log(chalk.cyan("Cloning test repo..."));
		const testsDir = await cloneRepo(tests.hosts, tests.commit);
		clonedDirs.push(testsDir);

		// Clone source repo
		console.log(chalk.cyan("Cloning source repo..."));
		const sourceDir = await cloneRepo(source.hosts, source.commit);
		clonedDirs.push(sourceDir);

		// Verify test repo if key provided
		if (tests.verifyWith) {
			await verifyRepoSignature(testsDir, tests, "test");
		}

		// Verify source repo if key provided
		if (source.verifyWith) {
			await verifyRepoSignature(sourceDir, source, "source");
		}

		// Run tests
		return await runTests(testsDir, sourceDir, { frameworks, timeout });
	} catch (error) {
		const duration = Date.now() - startTime;
		const errorMessage = error instanceof Error ? error.message : String(error);

		return {
			success: false,
			output: "",
			error: errorMessage,
			frameworkUsed: "unknown",
			duration,
		};
	} finally {
		// Cleanup cloned directories
		if (cleanup) {
			console.log(chalk.cyan("Cleaning up..."));
			for (const dir of clonedDirs) {
				await removeDirectory(dir);
			}
		} else {
			console.log(
				chalk.gray(`Cloned directories preserved: ${clonedDirs.join(", ")}`),
			);
		}
	}
}

async function verifyRepoSignature(
	repoDir: string,
	repo: RepoSpec,
	label: string,
): Promise<void> {
	const key = repo.verifyWith!;
	console.log(chalk.cyan(`Verifying ${label} repo signature...`));

	const isValid = await verifyRepo(
		repoDir,
		repo.commit,
		key.keyType,
		key.publicKey,
	);

	if (!isValid) {
		throw new Error(`${label} repo commit not signed by provided key`);
	}

	console.log(chalk.green(`✅ ${label} repo signature verified`));
}

// ============================================================================
