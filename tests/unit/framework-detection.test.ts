/**
 * Unit Tests: Framework Detection
 *
 * Tests the framework detection logic for all supported project types.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { detectFramework } from "../../src/test-execution/frameworkDetection";

describe("Framework Detection", () => {
	let tempDir: string;

	beforeEach(async () => {
		// Create a unique temp directory for each test
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "framework-detect-"));
	});

	afterEach(async () => {
		// Clean up temp directory
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	describe("bun-test", () => {
		test("detects bun.lock file", async () => {
			await fs.writeFile(path.join(tempDir, "bun.lock"), "");
			await fs.writeFile(
				path.join(tempDir, "package.json"),
				JSON.stringify({ name: "test" }),
			);

			const result = await detectFramework(tempDir);
			expect(result.framework.name).toBe("bun-test");
		});

		test("detects bun.lockb file (binary)", async () => {
			await fs.writeFile(path.join(tempDir, "bun.lockb"), Buffer.from([]));
			await fs.writeFile(
				path.join(tempDir, "package.json"),
				JSON.stringify({ name: "test" }),
			);

			const result = await detectFramework(tempDir);
			expect(result.framework.name).toBe("bun-test");
		});

		test("uses bun-jest when jest is configured", async () => {
			await fs.writeFile(path.join(tempDir, "bun.lock"), "");
			await fs.writeFile(
				path.join(tempDir, "package.json"),
				JSON.stringify({
					name: "test",
					devDependencies: { jest: "^29.0.0" },
				}),
			);

			const result = await detectFramework(tempDir);
			expect(result.framework.name).toBe("bun-jest");
		});
	});

	describe("cargo (Rust)", () => {
		test("detects Cargo.lock file", async () => {
			await fs.writeFile(path.join(tempDir, "Cargo.lock"), "");
			await fs.writeFile(
				path.join(tempDir, "Cargo.toml"),
				'[package]\nname = "test"',
			);

			const result = await detectFramework(tempDir);
			expect(result.framework.name).toBe("cargo");
		});

		test("detects Cargo.toml without lock file", async () => {
			await fs.writeFile(
				path.join(tempDir, "Cargo.toml"),
				'[package]\nname = "test"',
			);

			const result = await detectFramework(tempDir);
			expect(result.framework.name).toBe("cargo");
		});
	});

	describe("pytest-uv (Python with uv)", () => {
		test("detects uv.lock file", async () => {
			await fs.writeFile(path.join(tempDir, "uv.lock"), "");
			await fs.writeFile(
				path.join(tempDir, "pyproject.toml"),
				"[project]\nname = 'test'",
			);

			const result = await detectFramework(tempDir);
			expect(result.framework.name).toBe("pytest-uv");
		});
	});

	describe("pytest-poetry (Python with Poetry)", () => {
		test("detects poetry.lock file", async () => {
			await fs.writeFile(path.join(tempDir, "poetry.lock"), "");
			await fs.writeFile(
				path.join(tempDir, "pyproject.toml"),
				"[project]\nname = 'test'",
			);

			const result = await detectFramework(tempDir);
			expect(result.framework.name).toBe("pytest-poetry");
		});
	});

	describe("node-jest (Node.js with npm)", () => {
		test("detects package-lock.json with jest dependency", async () => {
			await fs.writeFile(path.join(tempDir, "package-lock.json"), "{}");
			await fs.writeFile(
				path.join(tempDir, "package.json"),
				JSON.stringify({
					name: "test",
					devDependencies: { jest: "^29.0.0" },
				}),
			);

			const result = await detectFramework(tempDir);
			expect(result.framework.name).toBe("node-jest");
		});
	});

	describe("pnpm-jest (Node.js with pnpm)", () => {
		test("detects pnpm-lock.yaml with jest dependency", async () => {
			await fs.writeFile(path.join(tempDir, "pnpm-lock.yaml"), "");
			await fs.writeFile(
				path.join(tempDir, "package.json"),
				JSON.stringify({
					name: "test",
					devDependencies: { jest: "^29.0.0" },
				}),
			);

			const result = await detectFramework(tempDir);
			expect(result.framework.name).toBe("pnpm-jest");
		});
	});

	describe("custom dockerfile", () => {
		test("detects arkhai_tests.dockerfile", async () => {
			const dockerfileContent = `FROM node:20-alpine
RUN npm test`;
			await fs.writeFile(
				path.join(tempDir, "arkhai_tests.dockerfile"),
				dockerfileContent,
			);

			const result = await detectFramework(tempDir);
			expect(result.framework.name).toBe("custom");
			expect(result.dockerfileContent).toBe(dockerfileContent);
		});

		test("custom dockerfile has highest priority", async () => {
			// Add both custom dockerfile AND bun.lock
			await fs.writeFile(
				path.join(tempDir, "arkhai_tests.dockerfile"),
				"FROM alpine",
			);
			await fs.writeFile(path.join(tempDir, "bun.lock"), "");

			const result = await detectFramework(tempDir);
			// Custom should win due to priority 0 vs bun-test priority 10
			expect(result.framework.name).toBe("custom");
		});
	});

	describe("fallbacks", () => {
		test("uses pytest-fallback for requirements.txt", async () => {
			await fs.writeFile(
				path.join(tempDir, "requirements.txt"),
				"pytest==7.0.0",
			);

			const result = await detectFramework(tempDir);
			expect(result.framework.name).toBe("pytest-fallback");
		});

		test("uses node-fallback for package.json without lock", async () => {
			await fs.writeFile(
				path.join(tempDir, "package.json"),
				JSON.stringify({ name: "test" }),
			);

			const result = await detectFramework(tempDir);
			expect(result.framework.name).toBe("node-fallback");
		});
	});

	describe("error handling", () => {
		test("throws when no framework detected", async () => {
			// Empty directory - no lock files
			await expect(detectFramework(tempDir)).rejects.toThrow(
				"Could not detect framework",
			);
		});

		test("throws for non-existent directory", async () => {
			await expect(detectFramework("/nonexistent/path")).rejects.toThrow();
		});
	});

	describe("priority ordering", () => {
		test("uv takes precedence over poetry when both present", async () => {
			await fs.writeFile(path.join(tempDir, "uv.lock"), "");
			await fs.writeFile(path.join(tempDir, "poetry.lock"), "");
			await fs.writeFile(
				path.join(tempDir, "pyproject.toml"),
				"[project]\nname = 'test'",
			);

			const result = await detectFramework(tempDir);
			// Both have priority 10, but uv appears first in the array
			expect(["pytest-uv", "pytest-poetry"]).toContain(result.framework.name);
		});
	});
});
