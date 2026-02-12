// Primitives
// Composition
// Default export
export {
	cloneRepo,
	runTests,
	verifyAndRunTests,
	verifyAndRunTests as default,
} from "./executor.js";
// Framework detection utility
export {
	detectFramework,
	type FrameworkDetectionResult,
} from "./frameworkDetection.js";
// Frameworks
export {
	bunJest,
	bunTest,
	cargo,
	customDockerfile,
	defaultFrameworks,
	nodeFallback,
	nodeJest,
	pnpmJest,
	pytestFallback,
	pytestPoetry,
	pytestUv,
} from "./frameworks/index.js";
// Types
export type {
	Framework,
	ProjectLanguage,
	RegisteredKey,
	RepoSpec,
	RunTestsOptions,
	TestResult,
	VerifyAndRunTestsOptions,
} from "./types.js";
