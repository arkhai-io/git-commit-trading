import { promises as fs } from "node:fs";
import path from "node:path";
import type { Framework } from "../types.js";

export const customDockerfile: Framework = {
	name: "custom",
	dockerfile: "", // Will be read from arkhai_tests.dockerfile
	detectionPriority: 0, // Highest priority - always checked first

	async detect(testsPath: string): Promise<boolean> {
		try {
			const files = await fs.readdir(testsPath);
			return files.includes("arkhai_tests.dockerfile");
		} catch {
			return false;
		}
	},

	parseTests(_output: string, exitCode: number): boolean {
		// For custom dockerfiles, rely on exit code
		return exitCode === 0;
	},
};

/**
 * Read the custom dockerfile content from the test repo.
 * This must be called after detection to populate the dockerfile content.
 */
export async function readCustomDockerfile(testsPath: string): Promise<string> {
	const dockerfilePath = path.join(testsPath, "arkhai_tests.dockerfile");
	return await fs.readFile(dockerfilePath, "utf-8");
}
