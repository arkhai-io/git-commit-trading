export type ProjectLanguage = 'typescript' | 'rust' | 'python';

export interface RepositoryConfig {
  url: string;
  branch?: string; // Optional, only used for fallback scenarios
  commitHash: string; // Required for archive downloads
  commitAlgo?: 'sha256' | 'md5' | 'sha1'; // Algorithm used for commit hash format validation
  language?: ProjectLanguage; // Explicit language specification, if not provided, will be auto-detected
  buildCommand?: string; // Full command like "npm run build", "cargo build", "python -m build"
  testCommand?: string; // Full command like "npm run test", "cargo test", "pytest"
  testDirectory?: string;
  installCommand?: string; // Full command like "npm install", "cargo build", "pip install -r requirements.txt"
}

export interface ExecutionConfig {
  timeout: number;
  cleanupAfterExecution: boolean;
  isolatedEnvironment: boolean;
  tempDirectory: string;
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
  dependenciesInstalled: boolean;
  testsExecuted: boolean;
  testResult: TestResult;
  cleanup: boolean;
  workingDirectory?: string;
}
