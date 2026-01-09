import type { Framework } from "../types.js";

export { bunJest } from "./bun-jest.js";
export { bunTest } from "./bun-test.js";
// Individual framework imports
export { cargo } from "./cargo.js";
export { customDockerfile, readCustomDockerfile } from "./custom.js";
export { nodeFallback, pytestFallback } from "./fallbacks.js";
export { nodeJest } from "./node-jest.js";
export { pnpmJest } from "./pnpm-jest.js";
export { pytestPoetry } from "./pytest-poetry.js";
export { pytestUv } from "./pytest-uv.js";

import { bunJest } from "./bun-jest.js";
import { bunTest } from "./bun-test.js";
import { cargo } from "./cargo.js";
// Import for array construction
import { customDockerfile } from "./custom.js";
import { nodeFallback, pytestFallback } from "./fallbacks.js";
import { nodeJest } from "./node-jest.js";
import { pnpmJest } from "./pnpm-jest.js";
import { pytestPoetry } from "./pytest-poetry.js";
import { pytestUv } from "./pytest-uv.js";

/**
 * All default frameworks in detection priority order
 */
export const defaultFrameworks: Framework[] = [
	customDockerfile, // Priority 0
	cargo, // Priority 10
	pytestUv, // Priority 10
	pytestPoetry, // Priority 10
	bunTest, // Priority 10
	bunJest, // Priority 10
	nodeJest, // Priority 10
	pnpmJest, // Priority 10
	pytestFallback, // Priority 200
	nodeFallback, // Priority 200
].sort((a, b) => a.detectionPriority - b.detectionPriority);
