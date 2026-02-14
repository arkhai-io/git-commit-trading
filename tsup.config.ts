import type { Plugin } from "esbuild";
import { defineConfig } from "tsup";

// esbuild doesn't support `import ... with { type: "text" }` syntax.
// This plugin strips the import attributes so the loader config can handle the files.
const stripImportAttributes: Plugin = {
	name: "strip-import-attributes",
	setup(build) {
		build.onLoad({ filter: /\.ts$/ }, async (args) => {
			const fs = await import("node:fs/promises");
			let contents = await fs.readFile(args.path, "utf8");
			// Strip `with { type: "text" }` from imports
			contents = contents.replace(/\s+with\s*\{[^}]*\}/g, "");
			// Strip shebangs (tsup banner adds the correct one)
			contents = contents.replace(/^#!.*\n/, "");
			return { contents, loader: "ts" };
		});
	},
};

export default defineConfig({
	entry: { "git-escrows": "src/cli/git-escrows.ts" },
	format: ["esm"],
	target: "node18",
	platform: "node",
	splitting: false,
	bundle: true,
	sourcemap: true,
	clean: true,
	outDir: "dist",
	banner: {
		js: "#!/usr/bin/env node",
	},
	loader: {
		".dockerfile": "text",
	},
	esbuildPlugins: [stripImportAttributes],
});
