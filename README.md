# Git Escrows CLI

A sophisticated git-based escrow system for code challenges, bounties, and trustless development workflows. This system bridges Git commits with blockchain verification, enabling secure code-for-payment exchanges with cryptographic commit verification.

## 🚀 Core Features

- **Cryptographic Commit Verification**: Verify Git commits using SSH, PGP, or X.509 signatures
- **Blockchain Integration**: Smart contract-based escrow system on Ethereum
- **Multi-Key Support**: Register and verify SSH Ed25519/ECDSA, PGP v4, and X.509 keys
- **Cross-Platform Builds**: Binary distribution for Linux, macOS, and Windows
- **Oracle Integration**: Automated test execution and verification
- **Comprehensive CLI**: Full-featured command-line interface for all operations

## 📋 Prerequisites

- **Bun** >= 1.2.20
- **Node.js** >= 18.x (for contract compilation)
- **Forge** (Foundry) for smart contract builds
- **Git** with configured SSH/PGP keys

## 🛠 Quick Start

### Installation

```bash
# Install dependencies
bun install

# Build smart contracts
bun run build:contracts

# Build CLI binary
bun run build:binary
```

### Configuration

Create a `.env` file or use the CLI to generate one:

```bash
# Initialize client with private key and network
./bin/git-escrows new-client --privateKey 0x... --network anvil
```

### Register Your Git Keys

```bash
# Register SSH key
./bin/git-escrows register-key --path ~/.ssh/id_ed25519.pub

# Register PGP key
./bin/git-escrows register-key --pgp-key-file ~/.gnupg/pubkey.asc

# Register X.509 certificate
./bin/git-escrows register-key --x509-cert-file ./cert.pem

# Verify registration
./bin/git-escrows check-key --verbose
```

## 🔧 CLI Commands

### Core Operations

#### Submit Escrow Demand
```bash
./bin/git-escrows submit \
  --tests-repo https://github.com/user/tests.git \
  --tests-commit abc123... \
  --reward 1000000000000000000 \
  --tests-command "bun test" \
  --arbiter 0x... \
  --token 0x...
```

#### List Available Escrows
```bash
./bin/git-escrows list [--address 0x...]
```

#### Fulfill Escrow (Submit Solution)
```bash
./bin/git-escrows fulfill \
  --escrow-id 1 \
  --solution-repo https://github.com/dev/solution.git \
  --solution-commit def456...
```

#### Collect Rewards
```bash
./bin/git-escrows collect --escrow-id 1
```

### Key Management

#### Register Keys
```bash
# SSH Keys
./bin/git-escrows register-key \
  --public-key-file ~/.ssh/id_ed25519.pub \
  --private-key-file ~/.ssh/id_ed25519

# PGP Keys  
./bin/git-escrows register-key \
  --pgp-key-file ~/.gnupg/pubkey.asc

# X.509 Certificates
./bin/git-escrows register-key \
  --x509-cert-file ./certificate.pem
```

#### Verify Registration
```bash
./bin/git-escrows check-key --address 0x... --verbose
```

### Development Server

Start the verification oracle server:

```bash
./bin/git-escrows server --port 3000 --config config.json
```

## 📋 Usage Scenarios

### Scenario 1: Submit a Demand (Challenge Creator)

**Use Case**: You want to create a coding challenge or bounty with specific test requirements and offer a reward for a working solution.

#### Prerequisites
- Test repository with comprehensive test suite
- Ethereum wallet with sufficient tokens for reward
- Git keys registered on-chain

#### Step-by-Step Process

**1. Prepare Your Test Repository**
```bash
# Ensure your test repo has:
# - Clear test cases
# - Build/install instructions
# - Specific commit with frozen requirements

git clone https://github.com/yourorg/challenge-tests.git
cd challenge-tests
git log --oneline -n 5  # Note the commit hash you want to use
```

**2. Setup Your Environment**
```bash
# Initialize client configuration
./bin/git-escrows new-client \
  --privateKey 0x1234567890abcdef... \
  --network sepolia

# Register your Git signing key (if not done already)
./bin/git-escrows register-key --path ~/.ssh/id_ed25519.pub
```

**3. Submit the Escrow Demand**
```bash
./bin/git-escrows submit \
  --tests-repo https://github.com/yourorg/challenge-tests.git \
  --tests-commit a1b2c3d4e5f6... \
  --reward 1000000000000000000 \
  --tests-command "bun test" \
  --arbiter 0xArbiterAddress... \
  --token 0xTokenContractAddress...
```

**4. Monitor Your Escrow**
```bash
# List your created escrows
./bin/git-escrows list --address 0xYourAddress

# Check status periodically
watch -n 30 './bin/git-escrows list --address 0xYourAddress'
```

---

### Scenario 2: Submit a Solution (Developer)

**Use Case**: You found an interesting coding challenge and want to submit your solution to claim the reward.

#### Prerequisites
- Solution implemented and tested locally
- Git commits signed with registered key
- Ethereum wallet for transactions

#### Step-by-Step Process

**1. Find Available Challenges**
```bash
# List all available escrows
./bin/git-escrows list

# Or filter by specific criteria
./bin/git-escrows list --address 0xSpecificDemander
```

**2. Analyze the Challenge**
```bash
# Clone the test repository to understand requirements
git clone https://github.com/challenger/test-repo.git
cd test-repo
git checkout a1b2c3d4e5f6...  # Use the specific commit from escrow

# Read requirements and test cases
cat README.md
ls tests/
```

**3. Develop Your Solution**
```bash
# Create your solution repository
git clone https://github.com/yourusername/solution-repo.git
cd solution-repo

# Implement your solution
# ... code, test, iterate ...

# Ensure tests pass locally against the challenge tests
git add .
git commit -S -m "Complete solution for challenge #123"
git push origin main

# Note your final commit hash
git log --oneline -n 1
```

**4. Setup Environment and Register Keys**
```bash
# Setup your client (if not done already)
./bin/git-escrows new-client \
  --privateKey 0xYourPrivateKey... \
  --network sepolia

# Register your signing key (required for commit verification)
./bin/git-escrows register-key \
  --public-key-file ~/.ssh/id_ed25519.pub \
  --private-key-file ~/.ssh/id_ed25519
```

**5. Submit Your Solution**
```bash
./bin/git-escrows fulfill \
  --escrow-id 42 \
  --solution-repo https://github.com/yourusername/solution-repo.git \
  --solution-commit def456abc789...
```

**6. Wait for Verification and Collect Reward**
```bash
# Monitor verification status
./bin/git-escrows list --address 0xYourAddress

# Once verified and approved, collect your reward
./bin/git-escrows collect --escrow-id 42
```

---

### Scenario 3: Run Your Own Oracle Server

**Use Case**: You want to run a verification oracle server to automatically test and verify solution submissions for escrow contracts.

#### Prerequisites
- Reliable server infrastructure
- Access to blockchain network
- Proper security configuration

#### Step-by-Step Process

**1. Server Setup and Configuration**
```bash
# Clone and setup the project
git clone https://github.com/yourorg/git-escrows.git
cd git-escrows/git-app
bun install
bun run build:contracts
bun run build:binary
```

**2. Configure Oracle Environment**
```bash
# Create oracle-specific .env
./bin/git-escrows new-client \
  --privateKey 0xOraclePrivateKey... \
  --network sepolia

# Register oracle's verification keys
./bin/git-escrows register-key --path ~/.ssh/id_rsa.pub
```

**3. Create Oracle Configuration File**
```json
# Create config/oracle-config.json
{
  "repositories": {
    "source": {
      "url": "dynamic",  # Will be provided by escrow submissions
      "branch": "main",
      "buildCommand": "bun install",
      "testCommand": "bun test",
      "installCommand": "bun install"
    },
    "testcase": {
      "url": "dynamic",  # Will be provided by escrow demands
      "branch": "main",
      "buildCommand": "bun install", 
      "testCommand": "bun test",
      "installCommand": "bun install"
    }
  },
  "execution": {
    "timeout": 300000,           # 5 minutes max per test
    "cleanupAfterExecution": true,
    "isolatedEnvironment": true,
    "tempDirectory": "/tmp/git-escrows",
    "maxMemoryMB": 1024,
    "allowedCommands": ["bun", "npm", "yarn", "pnpm", "cargo", "go", "python", "node"]
  },
  "security": {
    "enableNetworkAccess": false,    # Block network during tests
    "restrictFileSystem": true,      # Sandbox file access
    "timeboxExecution": true,        # Enforce strict timeouts
    "logAllActivity": true           # Audit trail
  },
  "oracle": {
    "autoVerifyEscrows": true,       # Automatically process new escrows
    "maxConcurrentJobs": 3,          # Parallel execution limit
    "retryFailedTests": 2,           # Retry attempts for flaky tests
    "enableDetailedLogging": true
  }
}
```

**4. Start Oracle Server**
```bash
# Start in production mode
./bin/git-escrows server \
  --port 3000 \
  --config config/oracle-config.json \
  --log-level info

# Or with PM2 for production deployment
pm2 start ./bin/git-escrows --name "git-escrows-oracle" -- \
  server --port 3000 --config config/oracle-config.json
```

**5. Monitor Oracle Operations**
```bash
# Check oracle status and logs
./bin/git-escrows server --status
tail -f logs/oracle.log

# Monitor processed escrows
./bin/git-escrows list --oracle-stats

# Health check endpoint
curl http://localhost:3000/health
```

**6. Production Deployment Considerations**
```bash
# Setup reverse proxy (nginx)
# Configure SSL/TLS certificates
# Setup monitoring and alerting
# Configure log rotation
# Setup automatic backups of verification results

# Example systemd service
sudo cp scripts/git-escrows-oracle.service /etc/systemd/system/
sudo systemctl enable git-escrows-oracle
sudo systemctl start git-escrows-oracle
```

## 🏗 Project Structure

```
src/
├── cli/                    # CLI interface and commands
│   ├── git-escrows.ts     # Main CLI entry point
│   └── commands/          # Individual command implementations
├── clients/               # Blockchain client abstractions
│   ├── commitObligation.ts
│   └── gitIdentityRegistry.ts
├── contracts/             # Smart contract ABIs and types
├── services/              # Core business logic
│   └── verificationService.ts
├── utils/                 # Utility functions
│   ├── gitVerification.ts
│   ├── keyUtils.ts
│   └── cryptoUtils.ts
└── test-execution/        # Test execution engine

contract/                  # Smart contracts (Solidity)
tests/                    # Comprehensive test suites
bin/                      # Compiled binaries
```

## 🧪 Testing

### Run Test Suite

```bash
# Build binary first (required for CLI tests)
bun run build:binary

# Run all tests
bun test

# Run specific test categories
bun test ./tests/integration-test.test.ts
bun test ./tests/gitKeyRegistration.test.ts
bun test ./tests/commitObligation.test.ts
```

### Test Categories

- **Unit Tests**: Individual component testing
- **Integration Tests**: End-to-end workflow validation  
- **Security Tests**: Cryptographic verification testing
- **Multi-language Tests**: Cross-platform execution testing

## 📦 Build & Distribution

### Local Development
```bash
bun run dev          # Watch mode
bun run start        # Standard execution
bun run cli          # Direct CLI access
```

### Production Builds
```bash
bun run build:binary           # Current platform
bun run build:binary:linux     # Linux x64
bun run build:binary:windows   # Windows x64
bun run build:all              # All platforms
```

### Package Distribution
```bash
bun run build                  # ESM/CJS library builds
```

## ⚙️ Configuration

### Environment Variables (.env)

The `.env` file contains **blockchain connection and authentication credentials**. This is your personal configuration for interacting with Ethereum networks and smart contracts.

**Purpose**: 
- Authenticate CLI commands with your private key
- Connect to specific blockchain networks (local/testnet/mainnet)
- Define smart contract addresses for your deployment

**Create `.env` file with:**

```bash
# Your Ethereum private key (required for all transactions)
PRIVATE_KEY=0x1234567890abcdef...

# Blockchain RPC endpoint 
RPC_URL=http://localhost:8545                    # Local development (Anvil)
# RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY  # Sepolia testnet
# RPC_URL=https://mainnet.infura.io/v3/YOUR_KEY  # Ethereum mainnet

# Smart contract deployment addresses (network-specific)
GIT_IDENTITY_REGISTRY_ADDRESS=0xabcd...         # Git key registry contract
COMMIT_OBLIGATION_ADDRESS=0xefgh...             # Escrow contract
ORACLE_ADDRESS=0xijkl...                        # Verification oracle contract

# Optional: Gas configuration
GAS_LIMIT=500000
GAS_PRICE=20000000000
```

**⚠️ Security Note**: Never commit `.env` files to version control. Add `.env` to your `.gitignore`.

### Config File (config.json)

The `config.json` file defines **test execution and repository handling settings**. This configures how the oracle server clones, builds, and tests repositories.

**Purpose**:
- Configure repository URLs and build commands for test execution
- Set execution timeouts and security constraints
- Define isolated execution environment parameters

**Create `config.json` with:**

```json
{
  "repositories": {
    "source": {
      "url": "https://github.com/user/solution.git",
      "branch": "main",
      "buildCommand": "bun install",              // Command to install dependencies
      "testCommand": "bun test",                  // Command to run tests
      "installCommand": "bun install"             // Alternative install command
    },
    "testcase": {
      "url": "https://github.com/user/tests.git",
      "branch": "main", 
      "buildCommand": "bun install",
      "testCommand": "bun test",
      "installCommand": "bun install"
    }
  },
  "execution": {
    "timeout": 300000,                            // 5 minutes timeout for test execution
    "cleanupAfterExecution": true,                // Remove temp files after tests
    "isolatedEnvironment": true,                  // Run in sandboxed environment
    "tempDirectory": "./temp",                    // Directory for temporary files
    "maxMemoryMB": 512,                          // Memory limit for test execution
    "allowedCommands": ["bun", "npm", "yarn", "pnpm", "cargo", "go"] // Whitelist of allowed commands
  },
  "security": {
    "enableNetworkAccess": false,                 // Block network access during tests
    "restrictFileSystem": true,                   // Limit file system access
    "timeboxExecution": true                      // Enforce strict timeouts
  }
}
```

### Configuration Usage Examples

```bash
# Use default config.json for oracle server
./bin/git-escrows server --port 3000

# Use custom configuration file
./bin/git-escrows server --port 3000 --config ./custom-config.json

# Generate .env file interactively
./bin/git-escrows new-client --privateKey 0x... --network sepolia
```

## 🔐 Security Features

- **Cryptographic Commit Verification**: Multi-algorithm support (SHA-1, SHA-256, MD5)
- **Key Type Detection**: Automatic SSH/PGP/X.509 key format detection
- **Isolated Execution**: Sandboxed test execution environment
- **Blockchain Verification**: Smart contract-enforced escrow rules
- **Multi-signature Support**: Arbiter and oracle verification patterns

## 🌐 Network Support

- **Local Development**: Anvil, Localhost
- **Testnets**: Sepolia, Goerli
- **Mainnet**: Ethereum mainnet

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes with signed commits
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

### Development Guidelines

- All commits must be signed (SSH/PGP)
- Add tests for new features
- Follow TypeScript best practices
- Update documentation for API changes

## 📝 License

MIT License - see [LICENSE](LICENSE) for details.

## 🆘 Troubleshooting

### Common Issues

1. **Key Registration Fails**
   - Ensure Git is configured with your key
   - Verify key format with `--verbose` flag
   - Check network connection and gas fees

2. **Test Execution Timeouts**
   - Increase timeout in config.json
   - Check repository accessibility
   - Verify build/test commands

3. **Binary Build Issues**
   - Update Bun to latest version
   - Clear `node_modules` and reinstall
   - Check target platform compatibility

For more help, check the test files in `tests/` directory for usage examples.

---

**Built with ❤️ using Bun, TypeScript, and Ethereum smart contracts.**
