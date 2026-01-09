import { promises as fs } from "fs";
import pnpmJestDockerfile from "../dockerfiles/pnpm-jest.dockerfile" with {
	type: "text",
};
import type { Framework } from "../types.js";

export const pnpmJest: Framework = {
	name: "pnpm-jest",
	detectionPriority: 10,
	dockerfile: pnpmJestDockerfile,

	async detect(testsPath: string): Promise<boolean> {
		try {
			const files = await fs.readdir(testsPath);
			return files.includes("pnpm-lock.yaml");
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
