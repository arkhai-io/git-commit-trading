// Primitives
export { cloneRepo, runTests } from './executor.js';

// Composition
export { verifyAndRunTests } from './executor.js';

// Types
export type {
  Framework,
  RegisteredKey,
  RunTestsOptions,
  TestResult,
  RepoSpec,
  VerifyAndRunTestsOptions,
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
