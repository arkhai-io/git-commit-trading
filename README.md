# Git Escrows CLI

A sophisticated git-based escrow system for code challenges, bounties, and trustless development workflows. This system bridges Git commits with blockchain verification, enabling secure code-for-payment exchanges with cryptographic commit verification.

## Core Features

- **Cryptographic Commit Verification**: Verify Git commits using SSH, PGP, or X.509 signatures
- **Blockchain Integration**: Smart contract-based escrow system on Ethereum
- **Multi-Key Support**: Register and verify SSH Ed25519/ECDSA, PGP v4, and X.509 keys
- **Cross-Platform Builds**: Binary distribution for Linux, macOS, and Windows
- **Oracle Integration**: Automated test execution and verification with Docker isolation
- **Framework Auto-Detection**: Automatically detects project frameworks and generates appropriate test environments
- **Embedded Dockerfiles**: 7 framework templates built into binary for zero-dependency test execution
- **Container Pool Management**: Smart container lifecycle with configurable concurrency limits
- **Comprehensive CLI**: Full-featured command-line interface for all operations

## Prerequisites

- **Bun** >= 1.2.20
- **Node.js** >= 18.x (for contract compilation)
- **Forge** (Foundry) for smart contract builds
- **Git** with configured SSH/PGP keys

## Quick Start

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
./bin/git-escrows-docker new-client --privateKey 0x... --network anvil
```

### Register Your Git Keys

```bash
# Register SSH key
./bin/git-escrows-docker register-key --path ~/.ssh/id_ed25519.pub

# Register PGP key
./bin/git-escrows-docker register-key --pgp-key-file ~/.gnupg/pubkey.asc

# Register X.509 certificate
./bin/git-escrows-docker register-key --x509-cert-file ./cert.pem

# Verify registration
./bin/git-escrows-docker check-key --verbose
```

## CLI Commands

### Core Operations

#### Submit Escrow Demand
```bash
./bin/git-escrows-docker submit \
  --tests-repo https://github.com/user/tests.git \
  --tests-commit abc123... \
  --reward 1000000000000000000 \
  --arbiter 0x... \
  --oracle 0x... \
  --token 0x...
```

**Dockerfile Handling:**
- **Auto-detection**: Automatically detects framework from lock files (package-lock.json, Cargo.toml, pyproject.toml, etc.)
- **Embedded templates**: 7 built-in dockerfile templates embedded in binary for common frameworks:
  - `cargo` - Rust projects with Cargo.toml
  - `pytest_uv` - Python projects with uv.lock
  - `pytest_poetry` - Python projects with poetry.lock
  - `bun_test` - Bun projects with bun.lockb (using `bun test`)
  - `bun_jest` - Bun projects with bun.lockb (using `bun jest`)
  - `node_jest` - Node.js projects with package-lock.json
  - `pnpm_jest` - Node.js projects with pnpm-lock.yaml
- **Repository dockerfile**: If `arkhai_tests.dockerfile` exists in test repo, it will be used automatically
- **Priority**: Repository dockerfile > Auto-detected template

#### List Available Escrows
```bash
# List all escrows
./bin/git-escrows-docker list

# Filter by status
./bin/git-escrows-docker list --status open

# Filter by address (buyer or recipient)
./bin/git-escrows-docker list --address 0x...

# Show detailed information
./bin/git-escrows-docker list --verbose

# Export as JSON or CSV
./bin/git-escrows-docker list --format json
./bin/git-escrows-docker list --format csv

# Combine options
./bin/git-escrows-docker list --status open --address 0x... --verbose --limit 10
```

**Note:** Requires `ERC20_ESCROW_OBLIGATION_ADDRESS` in your `.env` file. The command queries the blockchain directly using event logs from the ERC20EscrowObligation contract.

**Output includes:**
- Escrow UID, status, amount, and token address
- Buyer and arbiter addresses
- **Test repository URL** (GitHub repo)
- **Test commit hash**
- **Framework** (auto-detected from lock files)
- Creation timestamp and expiration time

#### Fulfill Escrow (Submit Solution)
```bash
./bin/git-escrows-docker fulfill \
  --escrow-uid 0x1234567890abcdef... \
  --solution-repo https://github.com/dev/solution.git \
  --solution-commit def456... \
  --verify-key  # Optional: verify git signing key matches registered key
```

#### Collect Rewards
```bash
./bin/git-escrows-docker collect --escrow-uid 0x1234567890abcdef...
```

### Key Management

#### Register Keys
```bash
# SSH Keys
./bin/git-escrows-docker register-key \
  --public-key-file ~/.ssh/id_ed25519.pub \
  --private-key-file ~/.ssh/id_ed25519

# PGP Keys  
./bin/git-escrows-docker register-key \
  --pgp-key-file ~/.gnupg/pubkey.asc

# X.509 Certificates
./bin/git-escrows-docker register-key \
  --x509-cert-file ./certificate.pem
```

#### Verify Registration
```bash
./bin/git-escrows-docker check-key --address 0x... --verbose
```

### Oracle Server

Start the verification oracle server:

```bash
./bin/git-escrows-docker server \
  --port 3000 \
  --mode past \
  --verify-key \
  --transport http
```

**Server Options:**
- `--port`: Server port (default: 3000)
- `--polling-interval`: Interval in ms to poll for new requests (default: 5000)
- `--timeout`: Test execution timeout in ms (default: 300000)
- `--cleanup`: Clean up containers after execution (default: true)
- `--mode`: Arbitration mode - `past`, `pastUnarbitrated`, `allUnarbitrated`, `all`, `future`
- `--verify-key`: Require git signing key verification
- `--transport`: Server transport - `http` or `websocket`

## Test Execution Architecture

### Framework Auto-Detection

The system automatically detects project frameworks by analyzing lock files in the test repository:

| Lock File | Framework | Dockerfile Template |
|-----------|-----------|---------------------|
| `Cargo.toml` | Rust/Cargo | `cargo` |
| `uv.lock` | Python/uv | `pytest_uv` |
| `poetry.lock` | Python/Poetry | `pytest_poetry` |
| `bun.lockb` + `bun test` command | Bun Test | `bun_test` |
| `bun.lockb` + `jest` command | Bun Jest | `bun_jest` |
| `package-lock.json` | Node.js Jest | `node_jest` |
| `pnpm-lock.yaml` | pnpm Jest | `pnpm_jest` |

### Dockerfile Templates

All dockerfile templates are embedded in the binary at build time, ensuring:
- **Zero external dependencies**: No need to distribute dockerfile files separately
- **Consistent execution**: Same templates across all deployments
- **Easy updates**: Modify `frameworks/*.dockerfile` and rebuild

Each dockerfile receives build arguments:
- `SOURCE_REPO`: Git URL of the solution repository
- `SOURCE_COMMIT`: Commit hash of the solution
- `TEST_REPO`: Git URL of the test repository
- `TEST_COMMIT`: Commit hash of the tests

### Container Pool Strategy

The oracle maintains a pool of Docker containers with smart lifecycle management:

**Key Principles:**
- **Fresh containers per test**: Each test builds a new container to prevent state pollution
- **Concurrent limit**: Maximum N containers run simultaneously (configurable)
- **Auto-cleanup**: Containers and images removed immediately after test completion
- **Wait on capacity**: New tests wait if pool is at capacity

**Benefits:**
- Isolation between tests
- Deterministic test environments
- Resource management
- Prevents runaway container growth

**Configuration via CLI:**
```bash
./bin/git-escrows-docker server \
  --cleanup \       # Enable auto-cleanup of containers
  --timeout 300000  # Timeout for test execution
```

## Usage Scenarios

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
./bin/git-escrows-docker new-client \
  --privateKey 0x1234567890abcdef... \
  --network sepolia

# Register your Git signing key (if not done already)
./bin/git-escrows-docker register-key --path ~/.ssh/id_ed25519.pub
```

**3. Submit the Escrow Demand**
```bash
./bin/git-escrows-docker submit \
  --tests-repo https://github.com/yourorg/challenge-tests.git \
  --tests-commit a1b2c3d4e5f6... \
  --reward 1000000000000000000 \
  --arbiter 0xArbiterAddress... \
  --oracle 0xOracleAddress... \
  --token 0xTokenContractAddress...
```

The system automatically detects the framework from lock files and generates the appropriate dockerfile.

**4. Monitor Your Escrow**
```bash
# List your created escrows
./bin/git-escrows-docker list --address 0xYourAddress

# Check status periodically
watch -n 30 './bin/git-escrows-docker list --address 0xYourAddress'
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
./bin/git-escrows-docker list

# Or filter by specific criteria
./bin/git-escrows-docker list --address 0xSpecificDemander
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
./bin/git-escrows-docker new-client \
  --privateKey 0xYourPrivateKey... \
  --network sepolia

# Register your signing key (required for commit verification)
./bin/git-escrows-docker register-key \
  --public-key-file ~/.ssh/id_ed25519.pub \
  --private-key-file ~/.ssh/id_ed25519
```

**5. Submit Your Solution**
```bash
./bin/git-escrows-docker fulfill \
  --escrow-uid 0x1234567890abcdef... \
  --solution-repo https://github.com/yourusername/solution-repo.git \
  --solution-commit def456abc789... \
  --verify-key  # Verify your git signing key matches registered key
```

**6. Wait for Verification and Collect Reward**
```bash
# Monitor verification status
./bin/git-escrows-docker list --address 0xYourAddress

# Once verified and approved, collect your reward
./bin/git-escrows-docker collect --escrow-uid 0x1234567890abcdef...
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
git clone https://github.com/yourorg/git-escrows-docker.git
cd git-escrows-docker/git-app
bun install
bun run build:contracts
bun run build:binary
```

**2. Configure Oracle Environment**
```bash
# Create oracle-specific .env
./bin/git-escrows-docker new-client \
  --privateKey 0xOraclePrivateKey... \
  --network sepolia

# Register oracle's verification keys
./bin/git-escrows-docker register-key --path ~/.ssh/id_rsa.pub
```

**3. Start Oracle Server**
```bash
# Start in production mode
./bin/git-escrows-docker server \
  --port 3000 \
  --mode pastUnarbitrated \
  --verify-key \
  --timeout 300000 \
  --cleanup \
  --transport http

# Or with PM2 for production deployment
pm2 start ./bin/git-escrows-docker --name "git-escrows-docker-oracle" -- \
  server --port 3000 --mode pastUnarbitrated --verify-key
```

**Server Modes:**
- `past`: Process all past arbitration requests
- `pastUnarbitrated`: Process only unarbitrated past requests
- `allUnarbitrated`: Process all unarbitrated requests (past + watching)
- `all`: Process all requests (past + future)
- `future`: Only watch for new requests

**4. Monitor Oracle Operations**
```bash
# Check server logs
tail -f logs/oracle.log

# Monitor processed escrows
./bin/git-escrows-docker list

# Health check endpoint (if using http transport)
curl http://localhost:3000/health
```

**5. Production Deployment Considerations**
```bash
# Setup reverse proxy (nginx)
# Configure SSL/TLS certificates
# Setup monitoring and alerting
# Configure log rotation
# Setup automatic backups of verification results

# Example systemd service
sudo cp scripts/git-escrows-docker-oracle.service /etc/systemd/system/
sudo systemctl enable git-escrows-docker-oracle
sudo systemctl start git-escrows-docker-oracle
```

## Repository Structure Requirements

### Test Repository Structure (Challenge/Demand)

The test repository should contain comprehensive test cases that define the challenge requirements. This repository will be cloned and executed by the oracle to verify solutions.

#### Required Structure
```
test-repo/
├── README.md                 # Challenge description and requirements
├── package.json             # Dependencies and scripts (for Node.js/Bun)
├── bun.lockb               # Lock file for reproducible builds
├── tests/                  # Test directory
│   ├── unit/              # Unit tests
│   ├── integration/       # Integration tests
│   └── acceptance/        # Acceptance criteria tests
├── fixtures/              # Test data and fixtures
│   ├── input/            # Sample input data
│   └── expected/         # Expected output data
├── docs/                 # Additional documentation
│   ├── API.md           # API specification (if applicable)
│   └── examples.md      # Usage examples
└── .gitignore           # Git ignore rules
```

#### Example Test Repository (JavaScript/TypeScript)
```json
// package.json
{
  "name": "fibonacci-challenge-tests",
  "version": "1.0.0",
  "description": "Test suite for Fibonacci sequence challenge",
  "scripts": {
    "test": "bun test",
    "test:unit": "bun test tests/unit",
    "test:integration": "bun test tests/integration"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "bun": "^1.2.0"
  }
}
```

```typescript
// tests/unit/fibonacci.test.ts
import { test, expect } from 'bun:test';

test('fibonacci sequence basic cases', () => {
  // Tests will import from the solution repo
  const { fibonacci } = require('../../../solution/src/fibonacci');
  
  expect(fibonacci(0)).toBe(0);
  expect(fibonacci(1)).toBe(1);
  expect(fibonacci(2)).toBe(1);
  expect(fibonacci(10)).toBe(55);
});

test('fibonacci performance test', () => {
  const { fibonacci } = require('../../../solution/src/fibonacci');
  
  const start = performance.now();
  const result = fibonacci(40);
  const duration = performance.now() - start;
  
  expect(result).toBe(102334155);
  expect(duration).toBeLessThan(1000); // Must complete within 1 second
});
```

#### Example Test Repository (Rust)
```toml
# Cargo.toml
[package]
name = "sorting-challenge-tests"
version = "0.1.0"
edition = "2021"

[dependencies]
# Add solution crate as dependency
solution = { path = "../solution" }

[dev-dependencies]
criterion = "0.5"
```

```rust
// tests/integration_test.rs
use solution::sort_algorithm;

#[test]
fn test_empty_array() {
    let mut arr: Vec<i32> = vec![];
    sort_algorithm(&mut arr);
    assert_eq!(arr, vec![]);
}

#[test]
fn test_performance_large_array() {
    let mut arr: Vec<i32> = (0..100000).rev().collect();
    let start = std::time::Instant::now();
    sort_algorithm(&mut arr);
    let duration = start.elapsed();
    
    assert!(arr.windows(2).all(|w| w[0] <= w[1])); // Verify sorted
    assert!(duration.as_millis() < 5000); // Must complete within 5 seconds
}
```

### Solution Repository Structure (Fulfillment)

The solution repository contains the implementation that attempts to satisfy the test requirements.

#### Required Structure
```
solution-repo/
├── README.md               # Solution description and approach
├── package.json           # Dependencies and build scripts
├── bun.lockb              # Lock file
├── src/                   # Source code
│   ├── main.ts           # Main entry point
│   ├── lib/              # Library modules
│   └── utils/            # Utility functions
├── docs/                 # Documentation
│   ├── approach.md       # Technical approach
│   └── complexity.md     # Time/space complexity analysis
├── examples/             # Usage examples
└── .gitignore           # Git ignore rules
```

#### Example Solution Repository (JavaScript/TypeScript)
```json
// package.json
{
  "name": "fibonacci-solution",
  "version": "1.0.0",
  "description": "Optimized Fibonacci sequence implementation", 
  "main": "src/fibonacci.ts",
  "scripts": {
    "build": "bun build src/fibonacci.ts --outdir dist",
    "test": "bun test",
    "start": "bun run src/main.ts"
  },
  "exports": {
    ".": "./src/fibonacci.ts"
  }
}
```

```typescript
// src/fibonacci.ts
const memo = new Map<number, number>();

export function fibonacci(n: number): number {
  if (n <= 1) return n;
  
  if (memo.has(n)) {
    return memo.get(n)!;
  }
  
  const result = fibonacci(n - 1) + fibonacci(n - 2);
  memo.set(n, result);
  return result;
}

// src/main.ts
import { fibonacci } from './fibonacci';

console.log('Fibonacci(10):', fibonacci(10));
```

#### Example Solution Repository (Rust)
```toml
# Cargo.toml
[package]
name = "solution"
version = "0.1.0"
edition = "2021"

[lib]
name = "solution"
path = "src/lib.rs"

[[bin]]
name = "main"
path = "src/main.rs"
```

```rust
// src/lib.rs
pub fn sort_algorithm(arr: &mut [i32]) {
    // Optimized quicksort implementation
    if arr.len() <= 1 {
        return;
    }
    quicksort(arr, 0, arr.len() - 1);
}

fn quicksort(arr: &mut [i32], low: usize, high: usize) {
    if low < high {
        let pi = partition(arr, low, high);
        if pi > 0 {
            quicksort(arr, low, pi - 1);
        }
        quicksort(arr, pi + 1, high);
    }
}
```

### Repository Integration Requirements

1. **Test Discovery**: Tests must be able to import/link with solution code
2. **Build Dependencies**: Solution must build successfully before tests run
3. **Output Format**: Tests should produce clear pass/fail results
4. **Performance Benchmarks**: Include performance requirements in tests
5. **Edge Cases**: Comprehensive test coverage including edge cases

## Command Output Examples

### List Command Output

```bash
./bin/git-escrows-docker list
```

**Example Output:**
```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                               AVAILABLE ESCROWS                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│ ID: 1                                                                           │
│ Status: PENDING_FULFILLMENT                                                  │
│ Demander: 0xa1b2c3d4e5f6...                                                    │
│ Reward: 1.5 ETH                                                                │
│ Token: ETH (Native)                                                             │
│ Tests: https://github.com/challenges/fibonacci-optimization                     │
│ Commit: a1b2c3d4e5f6789...                                                      │
│ Framework: bun-test (auto-detected)                                             │
│ Arbiter: 0x1234567890ab...                                                     │
│ Created: 2025-09-28 14:30:25 UTC                                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│ ID: 2                                                                           │
│ Status: UNDER_REVIEW                                                         │
│ Demander: 0xf1e2d3c4b5a6...                                                    │
│ Reward: 500 USDC                                                               │
│ Token: 0xa0b86991c431...                                                       │
│ Tests: https://github.com/challenges/sorting-algorithms                         │
│ Commit: f1e2d3c4b5a6...                                                        │
│ Framework: cargo (auto-detected)                                                │
│ Arbiter: 0xabcdef123456...                                                     │
│ Fulfillment: 0x9876543210fe... (pending verification)                          │
│ Created: 2025-09-29 09:15:42 UTC                                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│ ID: 3                                                                           │
│ Status: COMPLETED                                                            │
│ Demander: 0x1111222233334444...                                                │
│ Fulfiller: 0x5555666677778888...                                               │
│ Reward: 0.8 ETH                                                                │
│ Token: ETH (Native)                                                             │
│ Tests: https://github.com/challenges/web3-integration                           │
│ Solution: https://github.com/solutions/web3-solution                            │
│ Completed: 2025-09-27 18:45:12 UTC                                             │
└─────────────────────────────────────────────────────────────────────────────────┘

Summary: 3 total escrows (1 available, 1 under review, 1 completed)
Total Value Locked: 2.3 ETH + 500 USDC
```

### Check Key Command Output

```bash
./bin/git-escrows-docker check-key --verbose
```

**Example Output:**
```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          GIT KEY REGISTRATION STATUS                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│ Ethereum Address: 0xa1b2c3d4e5f6789abcdef1234567890abcdef12                     │
│ Network: Sepolia Testnet                                                        │
│ Registry Contract: 0x1234567890abcdef...                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│ SSH Ed25519 Key                                                              │
│ Status: REGISTERED                                                            │
│ Public Key: ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq...                         │
│ Fingerprint: SHA256:k4h9l2j3n4m5o6p7q8r9s0t1u2v3w4x5y6z7                       │
│ Registration TX: 0xabcdef1234567890...                                          │
│ Block: 4,521,337 (2025-09-28 14:25:31 UTC)                                     │
│ Git Config: user.signingkey matches registered key                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│ PGP Key                                                                      │
│ Status: NOT REGISTERED                                                        │
│ Local Key: Found (4096-bit RSA, expires 2026-09-28)                            │
│ Suggestion: Run `./bin/git-escrows-docker register-key --pgp-key-file ~/.gnupg/...`   │
├─────────────────────────────────────────────────────────────────────────────────┤
│ X.509 Certificate                                                            │
│ Status: NOT REGISTERED                                                        │
│ Local Cert: Not found                                                           │
└─────────────────────────────────────────────────────────────────────────────────┘

Verification Capability: SSH signatures (YES), PGP signatures (NO), X.509 signatures (NO)
Ready to submit solutions with SSH-signed commits
```

### Submit Command Output

```bash
./bin/git-escrows-docker submit --tests-repo https://github.com/challenges/fibonacci --tests-commit a1b2c3d4 --reward 1500000000000000000
```

**Example Output:**
```
Creating new escrow demand...

┌─────────────────────────────────────────────────────────────────────────────────┐
│                             ESCROW SUBMISSION                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│ Tests Repository: https://github.com/challenges/fibonacci                       │
│ Tests Commit: a1b2c3d4e5f6789abcdef1234567890abcdef12                          │
│ Reward Amount: 1.5 ETH                                                         │
│ Token: ETH (Native)                                                             │
│ Framework Detected: bun-test (auto-detected from bun.lockb)                    │
│ Dockerfile: Using embedded template                                             │
│ Commit Algorithm: SHA256                                                        │
│ Arbiter: 0x1234567890abcdef... (default)                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│ Validating repository access...                                              │
│ Repository accessible                                                         │
│ Commit exists and is signed                                                   │
│ Test command executable                                                       │
│ Sufficient balance for reward + gas                                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│ Broadcasting transaction...                                                  │
│ Transaction Hash: 0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef12     │
│ Gas Used: 342,156                                                              │
│ Gas Price: 20 gwei                                                             │
│ Total Cost: 0.006843 ETH                                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│ Waiting for confirmation...                                                   │
│ Transaction confirmed in block 4,521,445                                     │
│ Escrow created successfully!                                                 │
│                                                                                 │
│ Escrow ID: 42                                                               │
│ Explorer: https://sepolia.etherscan.io/tx/0xabcdef...                       │
│ Monitor: ./bin/git-escrows-docker list --address 0xa1b2c3d4e5f6...                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Fulfill Command Output

```bash
./bin/git-escrows-docker fulfill --escrow-uid 0x1234... --solution-repo https://github.com/dev/fibonacci-solution --solution-commit def456
```

**Example Output:**
```
Submitting solution...

┌─────────────────────────────────────────────────────────────────────────────────┐
│                            SOLUTION SUBMISSION                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│ Escrow UID: 0x1234567890abcdef...                                                                   │
│ Solution Repository: https://github.com/dev/fibonacci-solution                  │
│ Solution Commit: def456abc789def456abc789def456abc789def456                     │
│ Submitter: 0x9876543210fedcba...                                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│ Pre-submission validation...                                                 │
│ Escrow exists and is accepting solutions                                     │
│ Solution repository accessible                                               │
│ Commit exists and is properly signed                                         │
│ Commit signature matches registered key                                      │
│ No previous submission from this address                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│ Submitting to blockchain...                                                  │
│ Transaction Hash: 0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba09     │
│ Gas Used: 198,234                                                              │
│ Total Cost: 0.003965 ETH                                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│ Waiting for oracle verification...                                           │
│ Oracle processing started                                                    │
│ Cloning repositories...                                                      │
│ Building solution...                                                        │
│ Running tests...                                                             │
│ All tests passed! (32/32)                                                    │
│ Performance benchmarks met                                                   │
│ Solution verified successfully!                                              │
│                                                                                 │
│ Reward pending arbiter approval                                              │
│ Monitor: ./bin/git-escrows-docker list --address 0x9876543210fe...                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Server Startup Output

When the oracle server starts, it displays status information:

```
Oracle server starting...
├─ Port: 3000
├─ Mode: pastUnarbitrated
├─ Verify Keys: enabled
├─ Transport: http
├─ Timeout: 300000ms
└─ Cleanup: enabled

Listening on http://localhost:3000
Processing arbitration requests...
```

## Project Structure

```
src/
├── cli/                    # CLI interface and commands
│   ├── git-escrows-docker.ts     # Main CLI entry point
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

## Testing

### Run Test Suite

```bash
# Build binary first (required for CLI tests)
bun run build:binary

# Run all tests
bun test

# Run unit tests only
bun test ./tests/unit/

# Run integration tests (requires SSH keys and anvil)
bun test ./tests/integration/

# Run specific test file
bun test ./tests/unit/escrow.test.ts
```

### Test Structure

```
tests/
├── unit/                     # Unit tests for individual components
│   ├── escrow.test.ts       # Escrow creation and collection
│   ├── fulfillment.test.ts  # Fulfillment submission
│   ├── key-registration.test.ts  # SSH/PGP key registration
│   ├── key-types.test.ts    # Key type variants (PGP, SSH, X509)
│   ├── arbitration.test.ts  # Arbitration with/without key verification
│   └── framework-detection.test.ts  # Framework auto-detection
├── integration/              # End-to-end workflow tests
│   └── full-flow.test.ts    # Complete escrow flow with real crypto
└── utils/                    # Test utilities and setup
    └── setup.ts             # Test context and client setup
```

### Test Categories

- **Unit Tests**: Individual component testing (escrow, fulfillment, keys, arbitration)
- **Integration Tests**: End-to-end workflow validation with real cryptographic signatures
- **Framework Detection Tests**: All 10 supported framework variants
- **Key Type Tests**: PGP, SSH Ed25519, SSH Secp256k1, X509 key types

## Build & Distribution

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

## Configuration

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

**Security Note**: Never commit `.env` files to version control. Add `.env` to your `.gitignore`.

### Server Configuration

All server options are configured via CLI flags:

```bash
./bin/git-escrows-docker server \
  --port 3000 \                    # Server port
  --polling-interval 5000 \        # Poll interval in ms
  --timeout 300000 \               # Test execution timeout in ms
  --cleanup \                      # Auto-cleanup containers after execution
  --mode pastUnarbitrated \        # Arbitration mode
  --verify-key \                   # Require git signing key verification
  --transport http                 # Transport protocol (http or websocket)
```

**Generate .env file interactively:**
```bash
./bin/git-escrows-docker new-client --privateKey 0x... --network sepolia
```

## Security Features

- **Cryptographic Commit Verification**: Multi-algorithm support (SHA-1, SHA-256, MD5)
- **Key Type Detection**: Automatic SSH/PGP/X.509 key format detection
- **Isolated Execution**: Sandboxed test execution environment
- **Blockchain Verification**: Smart contract-enforced escrow rules
- **Multi-signature Support**: Arbiter and oracle verification patterns

## Network Support

- **Local Development**: Anvil, Localhost
- **Testnets**: Sepolia, Goerli
- **Mainnet**: Ethereum mainnet

## Contributing

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

## License

MIT License - see [LICENSE](LICENSE) for details.

## Troubleshooting

### Common Issues

1. **Key Registration Fails**
   - Ensure Git is configured with your key
   - Verify key format with `--verbose` flag
   - Check network connection and gas fees

2. **Test Execution Timeouts**
   - Increase timeout via `--timeout` flag (e.g., `--timeout 600000`)
   - Check repository accessibility
   - Verify the framework is detected correctly

3. **Binary Build Issues**
   - Update Bun to latest version
   - Clear `node_modules` and reinstall
   - Check target platform compatibility

For more help, check the test files in `tests/` directory for usage examples.

---

**Built with care using Bun, TypeScript, and Ethereum smart contracts.**
