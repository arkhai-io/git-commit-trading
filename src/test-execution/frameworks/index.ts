import type { Framework } from '../types.js';

// Individual framework imports
export { cargo } from './cargo.js';
export { pytestUv } from './pytest-uv.js';
export { pytestPoetry } from './pytest-poetry.js';
export { bunTest } from './bun-test.js';
export { bunJest } from './bun-jest.js';
export { nodeJest } from './node-jest.js';
export { pnpmJest } from './pnpm-jest.js';
export { customDockerfile, readCustomDockerfile } from './custom.js';
export { pytestFallback, nodeFallback } from './fallbacks.js';

// Import for array construction
import { customDockerfile } from './custom.js';
import { cargo } from './cargo.js';
import { pytestUv } from './pytest-uv.js';
import { pytestPoetry } from './pytest-poetry.js';
import { bunTest } from './bun-test.js';
import { bunJest } from './bun-jest.js';
import { nodeJest } from './node-jest.js';
import { pnpmJest } from './pnpm-jest.js';
import { pytestFallback, nodeFallback } from './fallbacks.js';

/**
 * All default frameworks in detection priority order
 */
export const defaultFrameworks: Framework[] = [
  customDockerfile, // Priority 0
  cargo,            // Priority 10
  pytestUv,         // Priority 10
  pytestPoetry,     // Priority 10
  bunTest,          // Priority 10
  bunJest,          // Priority 10
  nodeJest,         // Priority 10
  pnpmJest,         // Priority 10
  pytestFallback,   // Priority 200
  nodeFallback,     // Priority 200
].sort((a, b) => a.detectionPriority - b.detectionPriority);
