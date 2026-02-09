# Git Escrows Oracle Server - Docker

Build and run the oracle server (Charlie) as a Docker container. The oracle listens for fulfillment attestations on-chain, clones test and solution repositories, runs tests in isolated Docker containers, and records pass/fail decisions on-chain.

## Prerequisites

- Docker installed and running on the host
- A funded wallet private key (the oracle's address)
- RPC access to Base Sepolia (or your target network)
- Contract addresses for `CommitObligation` and `GitIdentityRegistry`

## Build

The build must be run from the **project root** (not from this directory), since the Dockerfile copies source code and dependencies from the root.

```bash
cd ..  # navigate to project root (git-commit-trading/)

docker build \
  -f oracle-server-docker/Dockerfile.oracle \
  -t git-escrows-oracle:latest \
  .
```

The multi-stage build:
1. **Builder stage** -- installs dependencies and compiles `git-escrows` into a standalone binary using Bun
2. **Runtime stage** -- minimal Debian image with git, gpg, openssh-client, and the Docker CLI (client only)

### Build for a specific platform

```bash
# Build for linux/amd64 (e.g., deploying to an x86 VM)
docker build \
  -f oracle-server-docker/Dockerfile.oracle \
  --platform linux/amd64 \
  -t git-escrows-oracle:latest \
  .

# Build for linux/arm64 (e.g., deploying to an ARM VM)
docker build \
  -f oracle-server-docker/Dockerfile.oracle \
  --platform linux/arm64 \
  -t git-escrows-oracle:latest \
  .
```

## Configure

Create a `.env` file with your oracle's configuration:

```env
PRIVATE_KEY=0x<your-oracle-private-key>
NETWORK=base-sepolia
RPC_URL=https://base-sepolia.infura.io/v3/<your-key>
COMMIT_OBLIGATION_ADDRESS=0x039336222fcec75041C8fE6c372997AF107e0d16
GIT_IDENTITY_REGISTRY_ADDRESS=0x199017039dcBAa45eDcABF761054f616ED6de654
ORACLE_ADDRESS=0x<your-oracle-wallet-address>
```

| Variable | Required | Description |
|----------|----------|-------------|
| `PRIVATE_KEY` | Yes | Oracle wallet private key (hex, `0x`-prefixed) |
| `NETWORK` | Yes | Network name (`base-sepolia`, `anvil`) |
| `RPC_URL` | Yes | HTTP RPC endpoint |
| `COMMIT_OBLIGATION_ADDRESS` | Yes | CommitObligation contract address |
| `GIT_IDENTITY_REGISTRY_ADDRESS` | No | GitIdentityRegistry contract (enables key verification) |
| `ORACLE_ADDRESS` | No | Oracle wallet address (derived from private key if omitted) |

## Run

The container needs access to the **host Docker socket** so it can build and run test containers.

```bash
docker run -d \
  --name git-escrows-oracle \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --env-file .env \
  git-escrows-oracle:latest
```

This starts the server with default settings: `--mode allUnarbitrated`, which processes any unarbitrated past fulfillments and then listens for new ones.

### With custom flags

The entrypoint is `git-escrows server`, so any arguments you append are passed as server flags:

```bash
docker run -d \
  --name git-escrows-oracle \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --env-file .env \
  --memory 2g \
  git-escrows-oracle:latest \
  --mode allUnarbitrated \
  --timeout 300000 \
  --polling-interval 1000 \
  --transport http \
  --verify-key \
  --cleanup
```

### Server flags

| Flag | Default | Description |
|------|---------|-------------|
| `--mode <mode>` | `allUnarbitrated` | Arbitration mode (see below) |
| `--transport <type>` | `http` | RPC transport: `http` or `websocket` |
| `--timeout <ms>` | `300000` | Test execution timeout (5 minutes) |
| `--polling-interval <ms>` | `1000` | How often to check for new fulfillments |
| `--cleanup` | `true` | Remove Docker images and cloned repos after each run |
| `--verify-key` | `true` | Verify commit signatures against registered keys |
| `--no-verify-key` | - | Skip key verification |

### Server modes

| Mode | Behavior |
|------|----------|
| `allUnarbitrated` | Process unarbitrated past fulfillments + listen for new (default) |
| `all` | Process all past fulfillments + listen for new |
| `pastUnarbitrated` | Process unarbitrated past only, then exit |
| `past` | Process all past only, then exit |
| `future` | Listen for new fulfillments only |

## Logs

```bash
# Follow logs
docker logs -f git-escrows-oracle

# Last 100 lines
docker logs --tail 100 git-escrows-oracle
```

A successful arbitration looks like:

```
Starting Git Escrows Arbiter Server...
Server configuration:
  Mode: Arbitrate Unarbitrated Past + Listen for New
  Transport: HTTP
  Polling Interval: 1000ms
  Test Timeout: 300000ms
  Cleanup: true
  Docker Execution: Enabled (framework-based)
Blockchain environment ready
  Oracle Address (Your Wallet): 0x...
  CommitObligation Contract: 0x...
  TrustedOracleArbiter Contract: 0x...
Server is now listening...
=============== Received new fulfillment to be arbitrated ===============
  Test repo hosts: https://github.com/user/challenge.git
  Test commit: abc123...
  Solution repo hosts: https://github.com/user/challenge.git
  Solution commit: def456...
Running verification and test execution...
Result: PASSED
Arbitration completed: PASSED
  Transaction Hash: 0x...
  Attestation UID: 0x...
```

## Health Check

The container has a built-in health check that verifies the `git-escrows` process is running:

```bash
docker inspect --format='{{.State.Health.Status}}' git-escrows-oracle
```

## Stop and Remove

```bash
docker stop git-escrows-oracle
docker rm git-escrows-oracle
```

## Rebuild and Redeploy

```bash
# Stop the running container
docker stop git-escrows-oracle && docker rm git-escrows-oracle

# Rebuild from project root
cd <project-root>
docker build -f oracle-server-docker/Dockerfile.oracle -t git-escrows-oracle:latest .

# Run again
docker run -d \
  --name git-escrows-oracle \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --env-file .env.oracle \
  git-escrows-oracle:latest
```

## How It Works

When the oracle receives a fulfillment event:

1. Reads `testsCommitHash` + `hosts` from the escrow's demand data
2. Reads `commitHash` + `hosts` from the fulfillment's obligation data
3. Clones the test repo at `testsCommitHash` into `test-repo/`
4. Clones the solution repo at `commitHash` into `source-repo/`
5. Detects the test framework (custom `arkhai_tests.dockerfile` takes priority, otherwise auto-detects from lockfiles)
6. Builds a Docker image with both directories in the build context
7. Runs the container -- exit code `0` = PASS, non-zero = FAIL
8. Records the decision on-chain as an EAS attestation

The oracle spawns Docker containers on the host (via the mounted socket) to run tests in isolation. Each test run has its own container that is cleaned up after execution.
