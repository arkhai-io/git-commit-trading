export interface RepositoryConfig {
  url: string;
  branch?: string; // Made optional since commitHash can be used instead
  commitHash?: string; // Optional commit hash to checkout specific commit
  commitAlgo?: 'sha256' | 'md5' | 'sha1'; // Algorithm used for commit hash format validation
  buildCommand?: string; // Full command like "npm run build" or "bun run build"
  testCommand?: string; // Full command like "npm run test" or "bun test"
  testDirectory?: string;
  installCommand?: string; // Full command like "npm install" or "bun install"
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
