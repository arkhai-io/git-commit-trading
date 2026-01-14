import { describe, expect, test, beforeAll } from "bun:test";
import { exec } from "child_process";
import path from "path";
import { promisify } from "util";
import { runTests } from "../../src/test-execution/index";

const execAsync = promisify(exec);
const EXAMPLES_DIR = path.resolve(__dirname, "../../examples/bun-test");

let containerAvailable = false;

beforeAll(async () => {
	// Check for docker or podman
	for (const runtime of ["docker", "podman"]) {
		try {
			await execAsync(`${runtime} --version`);
			containerAvailable = true;
			console.log(`Using container runtime: ${runtime}`);
			break;
		} catch {
			// Continue to next runtime
		}
	}
	if (!containerAvailable) {
		console.log("⚠️ No container runtime (docker/podman) available, skipping integration tests");
	}
});

describe("bun-test framework integration", () => {
	test("detects bun-test framework and runs tests successfully", async () => {
		if (!containerAvailable) {
			console.log("Skipping: No container runtime available");
			return;
		}

		const testsDir = path.join(EXAMPLES_DIR, "demand");
		const sourceDir = path.join(EXAMPLES_DIR, "fulfillment");

		const result = await runTests(testsDir, sourceDir, {
			timeout: 120000, // 2 minutes
		});

		expect(result.frameworkUsed).toBe("bun-test");
		expect(result.success).toBe(true);
		expect(result.error).toBeUndefined();
	}, 180000); // 3 minute timeout for the test itself
});
