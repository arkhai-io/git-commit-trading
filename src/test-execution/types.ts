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

/**
 * Reference to a git repository with multiple host fallbacks.
 */
export interface RepoRef {
  /** Git URLs to try in order (first success wins) */
  hosts: string[];
  /** Commit hash to checkout */
  commit: string;
}

/**
 * Options for executing tests.
 */
export interface ExecuteTestsOptions {
  /** Test repository reference */
  tests: RepoRef;
  /** Source/solution repository reference */
  source: RepoRef;
  /** Frameworks to try for detection (defaults to all built-in frameworks) */
  frameworks?: Framework[];
  /** Docker run timeout in milliseconds (default: 300000) */
  timeout?: number;
  /** Remove cloned repos and containers after execution (default: true) */
  cleanup?: boolean;
}

/**
 * Result of test execution.
 */
export interface ExecuteTestsResult {
  /** Whether all tests passed */
  success: boolean;
  /** Combined stdout/stderr output from test execution */
  output: string;
  /** Error message if tests failed */
  error?: string;
  /** Name of the framework that was used */
  frameworkUsed: string;
  /** Total execution duration in milliseconds */
  duration: number;
}
