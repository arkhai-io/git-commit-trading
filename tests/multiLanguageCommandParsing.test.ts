import { describe, expect, test } from "bun:test";
import { parseCommand } from "../src/test-execution/utils";

describe("Multi-language Command Parsing", () => {
	test("should use sh for Python venv commands with shell operators", () => {
		const pythonInstallCmd =
			"python3 -m venv venv && venv/bin/pip install --upgrade pip && venv/bin/pip install pytest";
		const { command, args } = parseCommand(pythonInstallCmd);

		expect(command).toBe("sh");
		expect(args).toEqual(["-c", pythonInstallCmd]);
	});

	test("should parse Python venv test commands directly when no shell operators", () => {
		const pythonTestCmd = "venv/bin/python -m pytest";
		const { command, args } = parseCommand(pythonTestCmd);

		// This doesn't have shell operators, so it should parse directly
		expect(command).toBe("venv/bin/python");
		expect(args).toContain("-m");
		expect(args).toContain("pytest");
	});

	test("should handle compound Python commands with shell operators", () => {
		const compoundCmd =
			"python3 -m venv venv && venv/bin/pip install -r requirements.txt";
		const { command, args } = parseCommand(compoundCmd);

		expect(command).toBe("sh");
		expect(args[0]).toBe("-c");
		expect(args[1]).toBe(compoundCmd);
	});

	test("should use sh for simple non-Python commands", () => {
		const simpleCmd = "echo 'hello' && ls -la";
		const { command, args } = parseCommand(simpleCmd);

		expect(command).toBe("sh");
		expect(args).toEqual(["-c", simpleCmd]);
	});

	test("should parse simple commands without shell", () => {
		const simpleCmd = "cargo test";
		const { command, args } = parseCommand(simpleCmd);

		expect(command).toBe("cargo");
		expect(args).toEqual(["test"]);
	});

	test("should parse npm commands correctly", () => {
		const npmCmd = "npm install";
		const { command, args } = parseCommand(npmCmd);

		expect(command).toBe("npm");
		expect(args).toEqual(["install"]);
	});

	test("should handle pipenv commands with bash", () => {
		const pipenvCmd = "pipenv install --dev";
		const { command, args } = parseCommand(pipenvCmd);

		expect(command).toBe("pipenv");
		expect(args).toEqual(["install", "--dev"]);
	});

	test("should handle compound pipenv commands", () => {
		const pipenvCmd = "pipenv install && pipenv run pytest";
		const { command, args } = parseCommand(pipenvCmd);

		expect(command).toBe("sh");
		expect(args[0]).toBe("-c");
	});
});
