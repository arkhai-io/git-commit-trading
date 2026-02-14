# Git Escrows

A decentralized bounty system for test suites. Challenge submitters create escrowed bounties for failing test suites, fulfillment submitters solve them and claim rewards, and arbiter oracles verify solutions through automated Docker-based test execution.

## Overview

Git Escrows enables trustless, code-execution-verified bounties:

1. **Alice** (Challenge Submitter) deposits tokens as a bounty for a failing test suite
2. **Bob** (Fulfillment Submitter) submits a solution and claims the reward
3. **Charlie** (Arbiter Oracle) automatically verifies by running tests in Docker

The system uses Ethereum Attestation Service (EAS) for on-chain records and supports Git-based identity verification through SSH, PGP, or X509 keys.

## Installation

```bash
npm i -g git-escrows
```

For development, clone the repo and install dependencies:

```bash
bun install
```

## Configuration

Create a `.env` file or use the CLI:

```bash
git-escrows new-client --privateKey "0x..." --network "sepolia"
```

### Environment Variables

```env
PRIVATE_KEY=0x...                           # Your wallet private key (address derived automatically)
NETWORK=base-sepolia                        # Network: anvil, base-sepolia, sepolia
RPC_URL=https://...                         # RPC endpoint

# Contract addresses (auto-configured for base-sepolia and sepolia)
# Only needed as overrides or for custom/local deployments
COMMIT_OBLIGATION_ADDRESS=0x...             # optional override
GIT_IDENTITY_REGISTRY_ADDRESS=0x...         # optional override
```

---

## Roles

### Challenge Submitter (Alice)

Creates escrowed bounties for test repositories with failing tests.

**Workflow:**

1. Prepare a test repository with a failing test suite
2. Choose a trusted arbiter oracle
3. Submit the challenge with a token reward

**Commands:**

```bash
# Create escrow bounty
git-escrows submit \
  --tests-repo "https://github.com/alice/challenge-tests.git" \
  --tests-commit "abc123..." \
  --reward "1000000000000000000" \
  --arbiter "0xArbiterContractAddress" \
  --oracle "0xCharlieAddress" \
  --token "0xERC20TokenAddress"
```

The command will:
- Clone the test repository to detect the test framework
- Display the detected framework and Dockerfile that will be used
- Lock your tokens in escrow
- Return an escrow UID to share with potential solvers

**Options:**
- `--tests-repo`: Git repository URL containing tests
- `--tests-commit`: Commit hash of the test suite
- `--reward`: Amount in wei to escrow
- `--arbiter`: Arbiter contract address
- `--oracle`: Oracle address (Charlie) who will run verification
- `--token`: ERC20 token contract for the reward

---

### Fulfillment Submitter (Bob)

Solves challenges by submitting repositories where the tests pass.

**Workflow:**

1. Browse open escrows
2. Register your Git signing key (for commit verification)
3. Write code that passes the challenge tests
4. Submit your solution
5. Collect the reward after arbitration passes

**Commands:**

```bash
# Register your Git key for identity verification
git-escrows register-key --path ~/.ssh/id_ed25519.pub

# Verify your key is registered
git-escrows check-key

# Browse open escrows
git-escrows list --status open

# Submit your solution
git-escrows fulfill \
  --escrow-uid "0x..." \
  --solution-repo "https://github.com/bob/solution.git" \
  --solution-commit "def456..."

# After arbitration passes, collect reward
git-escrows collect \
  --escrow-uid "0x..." \
  --fulfillment-uid "0x..."
```

**Key Registration:**
- Supports SSH (Ed25519, RSA, ECDSA), PGP v4, and X509 certificates
- Auto-detects key type from file content
- Signs a message proving key ownership
- Stores key claim on-chain via GitIdentityRegistry

**Fulfillment Options:**
- `--escrow-uid`: The escrow to fulfill
- `--solution-repo`: Git repository URL containing your solution
- `--solution-commit`: Commit hash of your solution (should be signed)
- `--additional-hosts`: Backup repository URLs (optional)
- `--verify-key` / `--no-verify-key`: Check if your key is registered before submitting

---

### Arbiter Oracle (Charlie)

Third-party arbiter trusted by challenge submitters to run tests and verify fulfillments.

**Workflow:**

1. Run the arbiter oracle
2. The oracle listens for fulfillment attestations
3. For each fulfillment:
   - Clone test and solution repositories
   - Verify commit signature (if enabled)
   - Run tests in Docker container
   - Record arbitration decision on-chain

**Commands:**

```bash
# Run arbiter oracle
git-escrows oracle \
  --mode allUnarbitrated \
  --timeout 300000 \
  --verify-key \
  --cleanup

# One-time arbitration of past fulfillments
git-escrows oracle --mode pastUnarbitrated
```

**Oracle Modes:**
- `allUnarbitrated` (default): Arbitrate unarbitrated past + listen for new
- `past`: Arbitrate all past fulfillments, then exit
- `pastUnarbitrated`: Arbitrate only unarbitrated past, then exit
- `all`: Arbitrate all past + listen for new
- `future`: Listen for new fulfillments only

**Options:**
- `--timeout`: Test execution timeout in milliseconds (default: 300000)
- `--verify-key`: Verify commit signatures against registered keys
- `--cleanup`: Remove Docker images and cloned repos after each run
- `--polling-interval`: Interval for checking new fulfillments (default: 1000ms)

---

## CLI Reference

| Command | Description |
|---------|-------------|
| `new-client` | Create `.env` configuration file |
| `register-key` | Register Git signing key on-chain |
| `check-key` | Verify if a key is registered for an address |
| `submit` | Create a new escrow bounty (Alice) |
| `fulfill` | Submit a solution to claim bounty (Bob) |
| `collect` | Collect reward after passing tests (Bob) |
| `list` | Query and display escrows |
| `oracle` | Run arbiter oracle (Charlie) |

### Listing Escrows

```bash
# List all open escrows
git-escrows list --status open

# List escrows by address
git-escrows list --address 0x...

# Export as JSON
git-escrows list --format json

# Verbose output with full details
git-escrows list --verbose --limit 50
```

---

## Supported Test Frameworks

The system auto-detects test frameworks from repository contents:

| Framework | Detection | Lock/Config Files |
|-----------|-----------|-------------------|
| Cargo (Rust) | Cargo.lock | `cargo test` |
| pytest + uv | pyproject.toml + uv.lock | `uv run pytest` |
| pytest + Poetry | poetry.lock | `poetry run pytest` |
| Bun Test | bun.lock | `bun test` |
| Bun + Jest | bun.lock + jest.config.* | `bun jest` |
| Node + Jest | package-lock.json + jest.config.* | `npm test` |
| pnpm + Jest | pnpm-lock.yaml + jest.config.* | `pnpm test` |

### Custom Dockerfile

For special requirements, add `arkhai_tests.dockerfile` to your test repository. This takes priority over auto-detection.

**Build Context:**

The Docker build context includes two directories:
- `source-repo/` - The fulfillment submitter's solution repository
- `test-repo/` - Your test repository (where the Dockerfile lives)

**Requirements:**
- File must be named exactly `arkhai_tests.dockerfile`
- Must be in the root of the test repository
- Exit code determines pass/fail: `0` = tests passed, non-zero = tests failed

**Example - Custom Node.js Setup:**

```dockerfile
# arkhai_tests.dockerfile
FROM node:20

WORKDIR /workspace

# Copy repositories from build context
COPY source-repo /workspace/source-repo
COPY test-repo /workspace/test-repo

# Merge: start with solution, add tests
RUN cp -r source-repo project
RUN cp -r test-repo/tests project/tests

WORKDIR /workspace/project

# Install and run
RUN npm install
CMD ["npm", "test"]
```

**Example - Rust with Custom Test Directory:**

```dockerfile
# arkhai_tests.dockerfile
FROM rust:latest

WORKDIR /workspace

COPY source-repo /workspace/source-repo
COPY test-repo /workspace/test-repo

# Merge source and tests
RUN cp -r source-repo project
RUN cp -r test-repo/integration-tests project/tests

WORKDIR /workspace/project

RUN cargo build
CMD ["cargo", "test", "--", "--nocapture"]
```

**Example - Python with Specific Dependencies:**

```dockerfile
# arkhai_tests.dockerfile
FROM python:3.12

WORKDIR /workspace

COPY source-repo /workspace/source-repo
COPY test-repo /workspace/test-repo

# Merge
RUN cp -r source-repo project
RUN cp -r test-repo/test_*.py project/

WORKDIR /workspace/project

# Install from test repo requirements (may have test-specific deps)
RUN pip install -r /workspace/test-repo/requirements.txt
CMD ["pytest", "-v"]
```

---

## Architecture

```
Challenge Submitter (Alice)
         │
         ▼
    [submit] ──► Escrow Attestation (EAS)
                        │
                        ▼
              Fulfillment Submitter (Bob)
                        │
                        ▼
    [fulfill] ──► Fulfillment Attestation
                        │
                        ▼
              Arbiter Oracle (Charlie)
                        │
                        ▼
    [oracle] ──► Clone repos ──► Run Docker tests ──► Record decision
                        │
                        ▼
    [collect] ◄── If tests pass, Bob collects reward
```

### Smart Contracts

- **CommitObligation**: Handles fulfillment submissions (solution attestations)
- **GitIdentityRegistry**: Stores registered Git signing keys

#### Canonical Deployments

Contracts are deployed on the following networks with built-in address defaults (no env vars needed):

| Network | CommitObligation | GitIdentityRegistry |
|---------|-----------------|---------------------|
| Base Sepolia | `0x03d2591DfDf75611AdE94A9a80af61F9BcBfc4e2` | `0xc6b3fA56853F7D5abdFdaa7d008d9c27eBdE3e8a` |
| Sepolia | `0x5bf1EE1fEC1bC25d20C4537f74bD0909B195DEBd` | `0x57D5165F9487F6E7bD6E6a24017FAdadc2b1D7D2` |

Set `COMMIT_OBLIGATION_ADDRESS` and `GIT_IDENTITY_REGISTRY_ADDRESS` in `.env` only to override these defaults (e.g., for local Anvil deployments).

#### Public Demo Oracle

A public demo oracle is running on Ethereum Sepolia at address `0xc5c132B69f57dAAAb75d9ebA86cab504b272Ccbc`. You can use this oracle when submitting escrows on Sepolia for testing.

### Test Execution

1. Clone test repository (from provided hosts)
2. Clone solution repository
3. Detect framework or use custom Dockerfile
4. Build Docker image with both repos
5. Execute tests with timeout
6. Parse output for pass/fail
7. Record arbitration decision on-chain

---

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Build for npm (outputs to dist/)
bun run build

# Build standalone binaries (macOS/Linux/Windows)
bun run build:all

# Deploy contracts (requires Foundry)
cd contract && forge script script/DeploySepolia.s.sol --broadcast        # Base Sepolia
cd contract && forge script script/DeployEthSepolia.s.sol --broadcast     # Ethereum Sepolia
```

## License

MIT
