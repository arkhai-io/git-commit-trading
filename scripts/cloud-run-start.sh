#!/bin/bash
set -e

# Cloud Run startup script for Oracle service
# This script ensures proper environment setup and starts the oracle server

echo "Starting Git Escrows Oracle Service..."

# Ensure required environment variables are set
if [ -z "$PRIVATE_KEY" ]; then
    echo "ERROR: PRIVATE_KEY environment variable is not set"
    exit 1
fi

if [ -z "$ADDRESS" ]; then
    echo "ERROR: ADDRESS environment variable is not set"
    exit 1
fi

# Create .env file from environment variables (Cloud Run secrets)
cat > /app/.env << EOF
PRIVATE_KEY=${PRIVATE_KEY}
ADDRESS=${ADDRESS}
NETWORK=${NETWORK:-base-sepolia}
RPC_URL=${RPC_URL}
WS_RPC_URL=${WS_RPC_URL:-}
COMMIT_OBLIGATION_ADDRESS=${COMMIT_OBLIGATION_ADDRESS:-}
GIT_IDENTITY_REGISTRY_ADDRESS=${GIT_IDENTITY_REGISTRY_ADDRESS:-}
GITHUB_TOKEN=${GITHUB_TOKEN:-}
DEBUG=${DEBUG:-false}
EOF

# Ensure temp directories exist and have proper permissions
mkdir -p /tmp/git-escrows /tmp/git-verify
chmod 777 /tmp/git-escrows /tmp/git-verify

# Set Git safe directory (needed for Cloud Run)
git config --global --add safe.directory '*'

# Verify uv is available
if ! command -v uv &> /dev/null; then
    echo "ERROR: uv is not available"
    exit 1
fi

# Verify clang is available
if ! command -v clang &> /dev/null; then
    echo "ERROR: clang is not available"
    exit 1
fi

# Verify git is available
if ! command -v git &> /dev/null; then
    echo "ERROR: git is not available"
    exit 1
fi

# Verify bun is available
if ! command -v bun &> /dev/null; then
    echo "ERROR: bun is not available"
    exit 1
fi

# Verify git dependency is accessible (should be linked during build)
if [ ! -d "/app/node_modules/alkahest-ts" ] || [ ! -f "/app/node_modules/alkahest-ts/package.json" ]; then
    echo "⚠️ Warning: alkahest-ts not found in node_modules"
    if [ -d "/tmp/deps/alkahest-ts" ]; then
        echo "Re-linking alkahest-ts..."
        mkdir -p /app/node_modules
        ln -sf /tmp/deps/alkahest-ts /app/node_modules/alkahest-ts
        echo "✓ Linked alkahest-ts"
    else
        echo "❌ Failed to locate alkahest-ts package"
        exit 1
    fi
fi

echo "Environment check passed"

# Start HTTP health check server for Cloud Run
# Cloud Run requires containers to listen on HTTP on the PORT env var
echo "Starting health check server on port ${PORT:-8080}..."
bun -e "
import { serve } from 'bun';
const port = parseInt(process.env.PORT || '8080');
serve({
  port: port,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response(JSON.stringify({ status: 'ok', service: 'git-escrows-oracle' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('Not Found', { status: 404 });
  }
});
console.log('✓ Health check server listening on port', port);
" &
HEALTH_PID=$!

# Give health server a moment to start
sleep 1

echo "Starting oracle server..."

# Start the oracle server in the foreground
# The server listens for blockchain events, not HTTP requests
# Run TypeScript directly with Bun (Bun handles git dependencies from cache)
exec bun run src/cli/git-escrows.ts server \
    --listen \
    --transport "${TRANSPORT:-http}" \
    --polling-interval "${POLLING_INTERVAL:-1000}" \
    --timeout "${TIMEOUT:-1800000}" \
    --cleanup \
    --skip-key-verification

