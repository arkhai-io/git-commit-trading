import { existsSync, mkdirSync, cpSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import os from "node:os";

interface InstallSkillsOptions {
	host?: string;
	path?: string;
	list?: boolean;
}

const KNOWN_HOSTS: Record<string, { name: string; skillsDir: string }> = {
	"claude-code": {
		name: "Claude Code",
		skillsDir: join(os.homedir(), ".claude", "skills"),
	},
	openclaw: {
		name: "OpenClaw",
		skillsDir: join(os.homedir(), ".openclaw", "workspace", "skills"),
	},
};

function getSkillsSourceDir(): string {
	// Navigate from this file to the repo/package root's skills/ directory
	// In dev: src/cli/commands/install-skills.ts -> ../../.. -> skills/
	// In dist: dist/git-escrows.js -> .. -> skills/
	const currentFile = fileURLToPath(import.meta.url);
	const currentDir = dirname(currentFile);

	// Try multiple possible locations relative to the executing file
	const candidates = [
		join(currentDir, "..", "..", "..", "skills"), // from src/cli/commands/
		join(currentDir, "..", "skills"), // from dist/
		join(currentDir, "skills"), // flat dist
	];

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	throw new Error(
		"Could not find skills directory. This may be a packaging issue.",
	);
}

function getAvailableSkills(sourceDir: string): string[] {
	return readdirSync(sourceDir, { withFileTypes: true })
		.filter(
			(entry) =>
				entry.isDirectory() &&
				existsSync(join(sourceDir, entry.name, "SKILL.md")),
		)
		.map((entry) => entry.name);
}

export async function installSkillsCommand(options: InstallSkillsOptions) {
	try {
		const sourceDir = getSkillsSourceDir();
		const skills = getAvailableSkills(sourceDir);

		if (skills.length === 0) {
			console.log(chalk.yellow("No skills found in package."));
			process.exit(1);
		}

		// List mode
		if (options.list) {
			console.log(chalk.blue("Available agent skills:\n"));
			for (const skill of skills) {
				console.log(chalk.white(`  ${skill}/SKILL.md`));
			}
			console.log(
				chalk.gray(`\nSource: ${sourceDir}`),
			);
			console.log(
				chalk.gray("\nSupported hosts: " + Object.keys(KNOWN_HOSTS).join(", ")),
			);
			return;
		}

		// Determine target directory
		let targetDir: string;
		let hostName: string;

		if (options.path) {
			targetDir = options.path;
			hostName = "custom path";
		} else if (options.host) {
			const hostKey = options.host.toLowerCase();
			const host = KNOWN_HOSTS[hostKey];
			if (!host) {
				console.error(
					chalk.red(
						`Unknown host: ${options.host}. Supported: ${Object.keys(KNOWN_HOSTS).join(", ")}`,
					),
				);
				console.error(
					chalk.gray("Use --path <directory> for a custom location."),
				);
				process.exit(1);
			}
			targetDir = host.skillsDir;
			hostName = host.name;
		} else {
			// Auto-detect: try each known host, check if its config directory exists
			const detected = Object.entries(KNOWN_HOSTS).find(([_, host]) =>
				existsSync(dirname(host.skillsDir)),
			);

			if (detected) {
				const [key, host] = detected;
				targetDir = host.skillsDir;
				hostName = host.name;
				console.log(
					chalk.gray(`Auto-detected host: ${hostName}`),
				);
			} else {
				console.error(chalk.red("Could not auto-detect an agent skills host."));
				console.log(chalk.yellow("\nSpecify a host with --host or --path:"));
				for (const [key, host] of Object.entries(KNOWN_HOSTS)) {
					console.log(chalk.gray(`  --host ${key}  →  ${host.skillsDir}`));
				}
				console.log(chalk.gray("  --path <dir>  →  custom directory"));
				process.exit(1);
			}
		}

		// Create target directory if needed
		mkdirSync(targetDir, { recursive: true });

		// Copy each skill
		console.log(chalk.blue(`Installing ${skills.length} skill(s) to ${hostName}...\n`));

		for (const skill of skills) {
			const src = join(sourceDir, skill);
			const dest = join(targetDir, skill);

			cpSync(src, dest, { recursive: true, force: true });
			console.log(chalk.green(`  ✓ ${skill}`));
		}

		console.log(chalk.gray(`\nInstalled to: ${targetDir}`));
		console.log(chalk.green("\nDone! Restart your agent to pick up the new skills."));
	} catch (error) {
		console.error(chalk.red("Failed to install skills:"));
		console.error(
			chalk.red(error instanceof Error ? error.message : String(error)),
		);
		process.exit(1);
	}
}
