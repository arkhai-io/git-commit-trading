import { promises as fs } from "fs";
import pytestPoetryDockerfile from "../dockerfiles/pytest-poetry.dockerfile" with {
	type: "text",
};
import type { Framework } from "../types.js";

export const pytestPoetry: Framework = {
	name: "pytest-poetry",
	detectionPriority: 10,
	dockerfile: pytestPoetryDockerfile,

	async detect(testsPath: string): Promise<boolean> {
		try {
			const files = await fs.readdir(testsPath);
			return files.includes("poetry.lock");
		} catch {
			return false;
		}
	},

	parseTests(output: string, exitCode: number): boolean {
		// Same as pytestUv - pytest output format
		const failedMatch = output.match(/(\d+) failed/);
		if (failedMatch?.[1] && parseInt(failedMatch[1]) > 0) return false;
		const passedMatch = output.match(/(\d+) passed/);
		if (passedMatch?.[1] && parseInt(passedMatch[1]) > 0) return true;
		return exitCode === 0;
	},
};
