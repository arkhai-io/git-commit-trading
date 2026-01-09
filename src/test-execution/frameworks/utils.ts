import { promises as fs } from "fs";
import path from "path";

/**
 * Check if a project uses Jest by looking for config files or package.json dependencies
 */
export async function checkForJest(
	projectPath: string,
	files: string[],
): Promise<boolean> {
	if (
		files.includes("jest.config.js") ||
		files.includes("jest.config.ts") ||
		files.includes("jest.config.json")
	) {
		return true;
	}

	if (files.includes("package.json")) {
		try {
			const packageJsonPath = path.join(projectPath, "package.json");
			const packageJson = JSON.parse(
				await fs.readFile(packageJsonPath, "utf-8"),
			);

			const hasJestDep =
				(packageJson.dependencies && "jest" in packageJson.dependencies) ||
				(packageJson.devDependencies && "jest" in packageJson.devDependencies);

			if (hasJestDep) return true;

			if (packageJson.scripts?.test?.includes("jest")) return true;
		} catch {
			return false;
		}
	}

	return false;
}
