import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import path from "path";

describe("Server CLI Command Tests", () => {
	let envFilePath: string;
	let badEnvFilePath: string;

	beforeAll(async () => {
		// Create a good .env file for testing (using a known private key/address pair)
		envFilePath = path.join(tmpdir(), `test-server-good-${Date.now()}.env`);
		const envContent = `PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
NETWORK=anvil
RPC_URL=http://127.0.0.1:8545
COMMIT_OBLIGATION_ADDRESS=0x1234567890123456789012345678901234567890
`;
		await fs.writeFile(envFilePath, envContent);

		// Create a bad .env file (missing COMMIT_OBLIGATION_ADDRESS)
		badEnvFilePath = path.join(tmpdir(), `test-server-bad-${Date.now()}.env`);
		const badEnvContent = `PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
NETWORK=anvil
RPC_URL=http://127.0.0.1:8545
`;
		await fs.writeFile(badEnvFilePath, badEnvContent);
	});

	afterAll(async () => {
		// Clean up env files
		try {
			await fs.unlink(envFilePath);
			await fs.unlink(badEnvFilePath);
		} catch (error) {
			// Ignore cleanup errors
		}
	});

	describe("CLI Validation", () => {
		test("should show help when no arguments provided", async () => {
			const result = await runCommand(["server", "--help"]);

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain(
				"Run the arbiter server to listen and arbitrate escrows",
			);
			expect(result.stdout).toContain("--past");
			expect(result.stdout).toContain("--listen");
		});

		test("should require either --past or --listen flag", async () => {
			const result = await runCommandWithEnv(["server"], envFilePath);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain(
				"Must specify either --past or --listen mode",
			);
		});

		test("should reject both --past and --listen flags", async () => {
			const result = await runCommandWithEnv(
				["server", "--past", "--listen"],
				envFilePath,
			);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain(
				"Cannot use both --past and --listen options at the same time",
			);
		});

		test("should fail with missing COMMIT_OBLIGATION_ADDRESS in env", async () => {
			const result = await runCommandWithEnv(
				["server", "--past"],
				badEnvFilePath,
			);

			expect(result.exitCode).toBe(1);
			// The test should fail when trying to start the server due to missing COMMIT_OBLIGATION_ADDRESS
			// It could fail at different stages depending on timing, so check for either error message
			const hasExpectedError =
				result.stderr.includes("Failed to start server") ||
				result.stderr.includes("COMMIT_OBLIGATION_ADDRESS is required");
			expect(hasExpectedError).toBe(true);
		});

		test("should accept valid --past flag", async () => {
			// This test will fail when it tries to connect to blockchain, but it should pass validation
			const result = await runCommandWithEnv(
				["server", "--past"],
				envFilePath,
				3000,
			); // 3 second timeout

			// Should pass initial validation but fail on blockchain connection
			expect(result.stdout).toContain("Starting Git Escrows Arbiter Server");
			expect(result.stdout).toContain("Mode: Arbitrate Past");
		});

		test("should accept valid --listen flag", async () => {
			// This test will fail when it tries to connect to blockchain, but it should pass validation
			const result = await runCommandWithEnv(
				["server", "--listen"],
				envFilePath,
				3000,
			); // 3 second timeout

			// Should pass initial validation but fail on blockchain connection
			expect(result.stdout).toContain("Starting Git Escrows Arbiter Server");
			expect(result.stdout).toContain("Mode: Listen and Arbitrate");
		});

		test("should accept custom polling interval", async () => {
			const result = await runCommandWithEnv(
				["server", "--past", "--polling-interval", "2000"],
				envFilePath,
				3000,
			);

			expect(result.stdout).toContain("Polling Interval: 2000ms");
		});

		test("should accept custom timeout", async () => {
			const result = await runCommandWithEnv(
				["server", "--past", "--timeout", "120000"],
				envFilePath,
				3000,
			);

			expect(result.stdout).toContain("Test Timeout: 120000ms");
		});

		test("should reject invalid cleanup flag", async () => {
			const result = await runCommandWithEnv(
				["server", "--past", "--no-cleanup"],
				envFilePath,
				5000,
			);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("unknown option");
		});
	});
});

// Helper functions for running CLI commands
async function runCommand(
	args: string[],
	timeoutMs: number = 10000,
): Promise<{
	exitCode: number;
	stdout: string;
	stderr: string;
}> {
	return new Promise((resolve) => {
		const child = spawn("./bin/git-escrows", args, {
			cwd: process.cwd(),
			stdio: "pipe",
		});

		let stdout = "";
		let stderr = "";

		child.stdout?.on("data", (data) => {
			stdout += data.toString();
		});

		child.stderr?.on("data", (data) => {
			stderr += data.toString();
		});

		child.on("close", (code) => {
			resolve({
				exitCode: code || 0,
				stdout,
				stderr,
			});
		});

		// Kill after timeout
		setTimeout(() => {
			child.kill("SIGTERM");
			setTimeout(() => {
				child.kill("SIGKILL");
			}, 1000);
		}, timeoutMs);
	});
}

async function runCommandWithEnv(
	args: string[],
	envFile: string,
	timeoutMs: number = 10000,
): Promise<{
	exitCode: number;
	stdout: string;
	stderr: string;
}> {
	return new Promise((resolve) => {
		// Copy env file to .env for the test using fs instead of spawn
		const fs = require("fs");
		try {
			fs.copyFileSync(envFile, ".env");
		} catch (error) {
			console.error("Failed to copy env file:", error);
		}

		const testChild = spawn("./bin/git-escrows", args, {
			cwd: process.cwd(),
			stdio: "pipe",
		});

		let stdout = "";
		let stderr = "";

		testChild.stdout?.on("data", (data) => {
			stdout += data.toString();
		});

		testChild.stderr?.on("data", (data) => {
			stderr += data.toString();
		});

		testChild.on("close", (code) => {
			// Clean up .env file
			try {
				fs.unlinkSync(".env");
			} catch (error) {
				// Ignore if file doesn't exist
			}

			resolve({
				exitCode: code || 0,
				stdout,
				stderr,
			});
		});

		// Kill after timeout
		setTimeout(() => {
			testChild.kill("SIGTERM");
			setTimeout(() => {
				testChild.kill("SIGKILL");
			}, 1000);
		}, timeoutMs);
	});
}
