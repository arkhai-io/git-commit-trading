export type ProjectLanguage = 'typescript' | 'rust' | 'python';

/**
 * Unified Framework interface for test execution.
 *
 * This interface allows frameworks to be easily extended - users can provide
 * custom frameworks as an entire arkhaiFramework.ts file, enabling support
 * for arbitrary test formats and parsing logic.
 */
export interface Framework {
  /** Unique identifier for the framework */
  name: string;

  /** Dockerfile template content for this framework */
  dockerfile: string;

  /**
   * Detect whether this framework should be used for the given test repo.
   * @param testsPath - Path to the test repository
   * @returns true if this framework matches the test repo
   */
  detect: (testsPath: string) => Promise<boolean>;

  /**
   * Priority for detection ordering. Lower = higher priority (checked first).
   * Recommended ranges:
   * - 0-99: High confidence (lock files present)
   * - 100-199: Medium confidence (config files present)
   * - 200-299: Low confidence (fallbacks)
   * - 1000: Custom dockerfile (always checked first as special case)
   */
  detectionPriority: number;

  /**
   * Parse test execution output to determine if tests passed.
   * @param output - Combined stdout/stderr from test execution
   * @param exitCode - Process exit code
   * @returns true if tests passed, false otherwise
   */
  parseTests: (output: string, exitCode: number) => boolean;
}


export interface RepositoryConfig {
  url: string; // Git repository URL (e.g. https://github.com/user/repo.git)
  branch?: string; // Optional, only used for fallback scenarios
  commitHash: string; // Required for git checkout to specific commit
  commitAlgo?: 'sha256' | 'md5' | 'sha1'; // Algorithm used for commit hash format validation
  language?: ProjectLanguage; // Explicit language specification, if not provided, will be auto-detected
  buildCommand?: string; // Full command like "npm run build", "cargo build", "python -m build"
  testCommand?: string; // Full command like "npm run test", "cargo test", "pytest"
  testDirectory?: string;
  installCommand?: string; // Full command like "npm install", "cargo build", "pip install -r requirements.txt"
  verifySignature?: boolean; // Whether to verify commit signature
  allowedSigners?: string[]; // Allowed signer identities (email addresses)
}

export interface ContainerPoolConfig {
  enabled: boolean; // Whether to use container pool
  poolSize: number; // Number of pre-warmed containers (not used for framework-based)
  imageName?: string; // Docker image name (optional, auto-generated for framework-based)
  containerPrefix: string; // Prefix for container names
  resetStrategy: 'restart' | 'cleanup'; // How to reset containers
}

export interface ExecutionConfig {
  timeout: number;
  cleanupAfterExecution: boolean;
  isolatedEnvironment: boolean;
  tempDirectory: string;
  verifyCommitSignatures?: boolean; // Enable signature verification
  contractAddress?: string; // GitIdentityRegistry contract address
  containerPool?: ContainerPoolConfig; // Container pool configuration
}

export interface Config {
  repositories: {
    source: RepositoryConfig;      // Bob's solution repository
    testcase: RepositoryConfig;    // Alice's test repository
  };
  execution: ExecutionConfig;
}

export interface TestResult {
  success: boolean;
  output: string;
  error?: string;
  duration: number;
  timestamp: Date;
}

export interface ExecutionResult {
  sourceCloned: boolean;
  testcaseCloned: boolean;
  sourceSignatureVerified?: boolean;
  testcaseSignatureVerified?: boolean;
  dependenciesInstalled: boolean;
  testsExecuted: boolean;
  testResult: TestResult;
  cleanup: boolean;
  workingDirectory?: string;
}
