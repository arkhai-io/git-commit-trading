import { promises as fs } from "node:fs";
import nodeJestDockerfile from "../dockerfiles/node-jest.dockerfile" with {
	type: "text",
};
import type { Framework } from "../types.js";

export const nodeJest: Framework = {
	name: "node-jest",
	detectionPriority: 10,
	dockerfile: nodeJestDockerfile,

	async detect(testsPath: string): Promise<boolean> {
		try {
			const files = await fs.readdir(testsPath);
			return files.includes("package-lock.json");
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
