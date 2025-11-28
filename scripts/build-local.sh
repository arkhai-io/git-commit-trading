#!/bin/bash
set -e

# Local Docker build script for testing
# Usage: ./scripts/build-local.sh [tag]

TAG="${1:-git-escrows-oracle:local}"

echo "Building Docker image locally..."
echo "Tag: $TAG"
echo ""

cd "$(dirname "$0")/.."

docker build -t "$TAG" -f Dockerfile .

echo ""
echo "✅ Build complete!"
echo ""
echo "To test the image locally:"
echo ""
echo "Option 1: Using .env file (recommended):"
echo "  docker run -it --rm --env-file .env $TAG"
echo ""
echo "Option 2: Manual environment variables:"
echo "  docker run -it --rm \\"
echo "    -e PRIVATE_KEY=0x... \\"
echo "    -e ADDRESS=0x... \\"
echo "    -e RPC_URL=https://... \\"
echo "    -e NETWORK=base-sepolia \\"
echo "    -e COMMIT_OBLIGATION_ADDRESS=0x... \\"
echo "    -e GIT_IDENTITY_REGISTRY_ADDRESS=0x... \\"
echo "    $TAG"
echo ""
echo "Option 3: Interactive shell (for debugging):"
echo "  docker run -it --rm --env-file .env --entrypoint /bin/bash $TAG"

