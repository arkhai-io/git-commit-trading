export type ProjectLanguage = 'typescript' | 'rust' | 'python';

export type FrameworkType = 
  | 'cargo' 
  | 'pytest-uv' 
  | 'pytest-poetry' 
  | 'bun-test' 
  | 'bun-jest' 
  | 'node-jest' 
  | 'pnpm-jest'
  | 'custom';

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
