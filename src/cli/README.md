# Git Escrows CLI

A command-line interface for the Git-based escrow system that enables code challenges and bounties.

## Overview

The Git Escrows system allows:
- **Alice** (Challenge Creator) to create escrows with coding challenges
- **Bob** (Developer) to submit solutions and earn rewards
- **Charlie** (Arbiter) to run automated testing and arbitration

## Installation

```bash
cd git-app
bun install
```

## Quick Reference

### Command Aliases
All these are equivalent:
- `bun run cli/git-escrows.ts`
- `bun run cli`  
- `bun run escrows`

### Workflow
1. **Everyone**: `bun run escrows list` → See available escrows
2. **Alice**: `bun run escrows submit ...` → Gets `Escrow UID`
3. **Charlie**: `bun run escrows server` → Starts listening
4. **Bob**: `bun run escrows list --status open` → Find escrows to fulfill
5. **Bob**: `bun run escrows fulfill ...` → Auto-tested by Charlie
6. **Bob**: `bun run escrows collect ...` → If tests passed

## Commands

### List Available Escrows

List all available escrows in the system:

```bash
# Basic listing
bun run escrows list

# Filter by status
bun run escrows list --status open
bun run escrows list --status fulfilled
bun run escrows list --status completed

# Different output formats
bun run escrows list --format table    # Pretty table (default)
bun run escrows list --format json     # JSON for programmatic use
bun run escrows list --format csv      # CSV for spreadsheets

# Limit results and verbose mode
bun run escrows list --limit 5 --verbose
```

**Options:**
- `--status <status>`: Filter by status (open, fulfilled, completed)
- `--limit <number>`: Maximum number of escrows to show (default: 20)
- `--format <format>`: Output format - table, json, or csv (default: table)
- `--verbose`: Show detailed information

### Submit a Challenge (Alice)

Create a new escrow demand for a coding challenge:

```bash
bun run escrows submit \
  --tests-repo "https://github.com/alice/tests.git" \
  --tests-commit "abc123..." \
  --reward "100"
```

**Required Options:**
- `--tests-repo <url>`: Git repository URL containing test cases
- `--tests-commit <hash>`: Commit hash of the test cases
- `--reward <amount>`: Reward amount in tokens

**Optional Options:**
- `--tests-command <cmd>`: Command to run tests (default: "npm test")
- `--tests-algo <algo>`: Commit hash algorithm (default: "sha1")
- `--arbiter <address>`: Arbiter contract address
- `--oracle <address>`: Oracle address for arbitration  
- `--token <address>`: ERC20 token contract address

### Fulfill a Challenge (Bob)

Submit a solution to fulfill an escrow demand:

```bash
# Check available escrows first
bun run escrows list --status open

# Submit solution
bun run escrows fulfill \
  --escrow-uid "0x..." \
  --solution-repo "https://github.com/bob/solution.git" \
  --solution-commit "def456..."

**Optional Options:**
- `--port <port>`: Server port (default: 3000)
- `--polling-interval <ms>`: Polling interval for new escrows in ms (default: 1000)
- `--timeout <ms>`: Test execution timeout in ms (default: 300000)
- `--cleanup`: Cleanup temporary directories after execution (default: true)

### Collect Reward (Bob)

Collect the reward from a fulfilled and approved escrow:

```bash
bun run escrows collect \
  --escrow-uid "0x..." \
  --fulfillment-uid "0x..."
```

**Required Options:**
- `--escrow-uid <uid>`: Escrow UID to collect from
- `--fulfillment-uid <uid>`: Fulfillment UID that was approved

## Help

```bash
bun run escrows --help           # Main help
bun run escrows list --help      # List command help
bun run escrows submit --help    # Submit command help
bun run escrows fulfill --help   # Fulfill command help
bun run escrows server --help    # Server command help
bun run escrows collect --help   # Collect command help
```
- **Test Execution Engine**: For automated testing of solutions
- **Git Integration**: For cloning and testing repositories

## Error Handling

The CLI provides detailed error messages and colored output for better user experience:
- 🚀 Blue: Starting operations
- ✅ Green: Success messages  
- ❌ Red: Error messages
- ⚠️ Yellow: Warnings and next steps
- 🔍 Gray: Debug/info messages

## Development

To contribute or modify the CLI:

```bash
# Run tests
bun test

# Run CLI in development
bun run cli/git-escrows.ts --help

# Build TypeScript
bun run build
```
