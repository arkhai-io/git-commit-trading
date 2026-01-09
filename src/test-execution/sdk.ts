// Main executor function
export { executeTests } from './executor.js';

// Types
export type {
  Framework,
  RepoRef,
  ExecuteTestsOptions,
  ExecuteTestsResult,
  ProjectLanguage,
} from './types.js';

// Frameworks
export {
  defaultFrameworks,
  cargo,
  pytestUv,
  pytestPoetry,
  bunTest,
  bunJest,
  nodeJest,
  pnpmJest,
  customDockerfile,
  pytestFallback,
  nodeFallback,
} from './frameworks/index.js';

// Framework detection utility
export { detectFramework, type FrameworkDetectionResult } from './frameworkDetection.js';
