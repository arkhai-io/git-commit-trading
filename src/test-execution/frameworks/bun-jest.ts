import { promises as fs } from "node:fs";
import bunJestDockerfile from "../dockerfiles/bun-jest.dockerfile" with {
	type: "text",
};
import type { Framework } from "../types.js";
import { checkForJest } from "./utils.js";

export const bunJest: Framework = {
	name: "bun-jest",
	detectionPriority: 10,
	dockerfile: bunJestDockerfile,

	async detect(testsPath: string): Promise<boolean> {
		try {
			const files = await fs.readdir(testsPath);
			// Check for bun.lockb (binary, older) or bun.lock (text, newer)
			if (!files.includes("bun.lockb") && !files.includes("bun.lock"))
				return false;
			return await checkForJest(testsPath, files);
		} catch {
			return false;
		}
	},

	parseTests(output: string, exitCode: number): boolean {
		// Jest outputs "Tests: X passed" or "Tests: X failed"
		if (output.includes("Tests:") && output.includes("failed")) return false;
		if (output.includes("Tests:") && output.includes("passed")) return true;
		return exitCode === 0;
	},
};
