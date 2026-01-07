// Main SDK exports
export { GitTestExecution } from './sdk.js';
export { TestExecutor } from './executor.js';
export { ContainerPool } from './containerPool.js';
export { detectFramework } from './frameworkDetection.js';
export type { Config, ExecutionResult, TestResult, RepositoryConfig, ContainerPoolConfig, Framework } from './types.js';
export { loadConfig } from './utils.js';
export { defaultFrameworks, cargo, pytestUv, pytestPoetry, bunTest, bunJest, nodeJest, pnpmJest, customDockerfile } from './frameworks.js';

// Default export for convenience
export { GitTestExecution as default } from './sdk.js';
