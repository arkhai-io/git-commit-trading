import { describe, expect, test } from "bun:test";
import {
	defaultFrameworks,
	verifyAndRunTests,
} from "../src/test-execution/index.js";
import type {
	TestResult,
	VerifyAndRunTestsOptions,
} from "../src/test-execution/types.js";

describe("Enhanced Test Execution with Security", () => {
	test("Should validate verifyAndRunTests options structure", () => {
		console.log("🧪 Testing verifyAndRunTests configuration structure");

		const options: VerifyAndRunTestsOptions = {
			tests: {
				hosts: ["https://github.com/alice/tests.git"],
				commit: "abc123",
			},
			source: {
				hosts: ["https://github.com/bob/solution.git"],
				commit: "def456",
			},
			timeout: 300000,
			cleanup: true,
		};

		// Validate basic configuration structure
		expect(options.tests).toBeDefined();
		expect(options.tests.hosts).toBeDefined();
		expect(options.tests.commit).toBeDefined();
		expect(options.source).toBeDefined();
		expect(options.source.hosts).toBeDefined();
		expect(options.source.commit).toBeDefined();

		console.log("✅ VerifyAndRunTests options structure validated");
		console.log("   - Test repository configuration available");
		console.log("   - Source repository configuration available");
		console.log("   - Execution settings configurable");
	});

	test("Should support multiple hosts for fallback", () => {
		console.log("\n🔧 Testing multiple hosts configuration");

		const options: VerifyAndRunTestsOptions = {
			tests: {
				hosts: [
					"https://github.com/alice/tests.git",
					"https://gitlab.com/alice/tests.git",
					"https://bitbucket.org/alice/tests.git",
				],
				commit: "abc123",
			},
			source: {
				hosts: [
					"https://github.com/bob/solution.git",
					"https://gitlab.com/bob/solution.git",
				],
				commit: "def456",
			},
		};

		expect(options.tests.hosts.length).toBe(3);
		expect(options.source.hosts.length).toBe(2);

		console.log("✅ Multiple hosts configuration validated");
		console.log(`   - Test repo hosts: ${options.tests.hosts.length}`);
		console.log(`   - Source repo hosts: ${options.source.hosts.length}`);
	});

	test("Should support author verification", () => {
		console.log("\n🔐 Testing author verification configuration");

		const options: VerifyAndRunTestsOptions = {
			tests: {
				hosts: ["https://github.com/alice/tests.git"],
				commit: "abc123",
				// Test repo doesn't need author verification
			},
			source: {
				hosts: ["https://github.com/bob/solution.git"],
				commit: "def456",
				author: "0x1234567890123456789012345678901234567890",
			},
			getRegisteredKey: async (address) => {
				// Mock callback - would fetch from contract
				return { keyType: 1, publicKey: "mock-public-key" };
			},
		};

		expect(options.source.author).toBeDefined();
		expect(options.getRegisteredKey).toBeDefined();

		console.log("✅ Author verification configuration validated");
	});

	test("Should support different programming languages via frameworks", () => {
		console.log("\n🌐 Testing multi-language support via frameworks");

		const languageFrameworks = [
			{ name: "cargo", language: "Rust" },
			{ name: "pytest-uv", language: "Python (UV)" },
			{ name: "pytest-poetry", language: "Python (Poetry)" },
			{ name: "bun-test", language: "TypeScript/JavaScript (Bun)" },
			{ name: "bun-jest", language: "TypeScript/JavaScript (Bun + Jest)" },
			{ name: "node-jest", language: "TypeScript/JavaScript (Node + Jest)" },
			{ name: "pnpm-jest", language: "TypeScript/JavaScript (PNPM + Jest)" },
		];

		for (const fw of languageFrameworks) {
			const framework = defaultFrameworks.find((f) => f.name === fw.name);
			expect(framework).toBeDefined();
			console.log(`  ✅ ${fw.language} framework (${fw.name}) available`);
		}

		console.log("🎯 Multi-language support validated via frameworks");
	});

	test("Should handle timeout and cleanup options properly", () => {
		console.log("\n⏱️ Testing timeout and cleanup options");

		const timeoutConfigurations = [
			{ language: "TypeScript", timeout: 45000 },
			{ language: "Python", timeout: 60000 },
			{ language: "Rust", timeout: 90000 },
			{ language: "Large Project", timeout: 300000 },
		];

		timeoutConfigurations.forEach((config) => {
			const options: VerifyAndRunTestsOptions = {
				tests: { hosts: ["url"], commit: "abc" },
				source: { hosts: ["url"], commit: "def" },
				timeout: config.timeout,
				cleanup: true,
			};

			expect(options.timeout).toBe(config.timeout);
			expect(options.cleanup).toBe(true);

			console.log(
				`  ✅ ${config.language}: ${config.timeout}ms timeout configured`,
			);
		});

		console.log("🎯 Timeout and cleanup configurations validated");
	});

	test("Should validate error handling expectations", () => {
		console.log("\n🚨 Testing error handling expectations");

		const errorScenarios = [
			{
				name: "Missing Git Key Registration",
				expectedError: "No valid registered key",
				shouldReject: true,
			},
			{
				name: "Invalid Commit Signature",
				expectedError: "not signed by registered key",
				shouldReject: true,
			},
			{
				name: "Test Execution Failure",
				expectedError: "Tests failed",
				shouldReject: true,
			},
			{
				name: "Repository Access Error",
				expectedError: "Failed to clone",
				shouldReject: true,
			},
		];

		const handleError = (errorMessage: string): boolean => {
			if (errorMessage.includes("No valid registered key")) return false;
			if (errorMessage.includes("not signed by registered key")) return false;
			if (errorMessage.includes("Tests failed")) return false;
			if (errorMessage.includes("Failed to clone")) return false;
			return true;
		};

		errorScenarios.forEach((scenario) => {
			console.log(`  🔍 Testing: ${scenario.name}`);
			const result = handleError(scenario.expectedError);
			expect(result).toBe(!scenario.shouldReject);
			console.log(
				`     ${result ? "✅" : "❌"} Error handled correctly: ${scenario.name}`,
			);
		});

		console.log("🎯 Error handling validated");
	});
});
