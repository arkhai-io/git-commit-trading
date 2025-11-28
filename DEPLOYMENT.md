# Oracle Deployment Guide for Google Cloud Run

This guide explains how to deploy the Git Escrows Oracle service to Google Cloud Run.

## Prerequisites

1. Google Cloud Project with billing enabled
2. `gcloud` CLI installed and authenticated
3. Docker installed (for local testing)
4. Artifact Registry API enabled
5. Cloud Run API enabled
6. Cloud Build API enabled

## Architecture

The Oracle service runs as a Cloud Run service that:
- Listens for blockchain events (ArbitrationRequested)
- Clones Git repositories
- Verifies commit signatures (SSH, PGP, X509)
- Executes tests in isolated environments
- Submits arbitration decisions on-chain

## Docker Image Contents

The Docker image includes:
- **Bun**: JavaScript/TypeScript runtime
- **clang**: C/C++ compiler for native dependencies
- **uv**: Fast Python package manager
- **Git**: Version control system
- **GPG/SSH tools**: For commit signature verification
- **Rust toolchain**: For Rust projects
- **Build tools**: make, cmake, pkg-config

## Setup Steps

### 1. Create Artifact Registry Repository

```bash
gcloud artifacts repositories create oracle-images \
    --repository-format=docker \
    --location=us-central1 \
    --description="Docker images for Git Escrows Oracle"
```

### 2. Create Secret Manager Secrets

Create secrets in Google Secret Manager for sensitive configuration:

```bash
# Set your values
PROJECT_ID=your-project-id
PRIVATE_KEY=0x...
ADDRESS=0x...
RPC_URL=https://...
NETWORK=base-sepolia
COMMIT_OBLIGATION_ADDRESS=0x...
GIT_IDENTITY_REGISTRY_ADDRESS=0x...
GITHUB_TOKEN=ghp_...  # GitHub Personal Access Token (optional but recommended)

# Create secrets
echo -n "$PRIVATE_KEY" | gcloud secrets create oracle-private-key --data-file=-
echo -n "$ADDRESS" | gcloud secrets create oracle-address --data-file=-
echo -n "$RPC_URL" | gcloud secrets create oracle-rpc-url --data-file=-
echo -n "$NETWORK" | gcloud secrets create oracle-network --data-file=-
echo -n "$COMMIT_OBLIGATION_ADDRESS" | gcloud secrets create oracle-commit-obligation-address --data-file=-
echo -n "$GIT_IDENTITY_REGISTRY_ADDRESS" | gcloud secrets create oracle-git-identity-registry-address --data-file=-

# Create GitHub token secret (optional but recommended for private repos or rate limiting)
if [ ! -z "$GITHUB_TOKEN" ]; then
  echo -n "$GITHUB_TOKEN" | gcloud secrets create github-token --data-file=-
fi
```

### 3. Grant Cloud Run Service Account Access

```bash
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud secrets add-iam-policy-binding oracle-private-key \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding oracle-address \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding oracle-rpc-url \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding oracle-network \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding oracle-commit-obligation-address \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding oracle-git-identity-registry-address \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor"

# Grant access to GitHub token (if created)
gcloud secrets add-iam-policy-binding github-token \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor" 2>/dev/null || echo "GitHub token secret not found, skipping..."
```

### 4. Build and Deploy

#### Option A: Using Cloud Build (Recommended)

**Important:** Always specify `--region` to match your Artifact Registry region:

```bash
gcloud builds submit \
    --region=asia-southeast1 \
    --config=cloudbuild.yaml \
    --substitutions=_REGION=asia-southeast1,_REPO_NAME=git-commit-trading-images,_SERVICE_NAME=git-escrows-oracle,_MEMORY=2Gi,_CPU=2,_TIMEOUT=900,_MAX_INSTANCES=10,_MIN_INSTANCES=0
```

Or use the deploy script (recommended):

```bash
./scripts/deploy.sh --project-id YOUR_PROJECT_ID --region asia-southeast1
```

#### Option B: Manual Build and Deploy

```bash
# Build the image
docker build -t gcr.io/$PROJECT_ID/git-escrows-oracle:latest .

# Push to Artifact Registry
docker tag gcr.io/$PROJECT_ID/git-escrows-oracle:latest \
    us-central1-docker.pkg.dev/$PROJECT_ID/oracle-images/git-escrows-oracle:latest

docker push us-central1-docker.pkg.dev/$PROJECT_ID/oracle-images/git-escrows-oracle:latest

# Deploy to Cloud Run
gcloud run deploy git-escrows-oracle \
    --image=us-central1-docker.pkg.dev/$PROJECT_ID/oracle-images/git-escrows-oracle:latest \
    --region=us-central1 \
    --platform=managed \
    --allow-unauthenticated \
    --memory=2Gi \
    --cpu=2 \
    --timeout=900 \
    --max-instances=10 \
    --min-instances=0 \
    --set-env-vars="PORT=8080" \
    --set-secrets="PRIVATE_KEY=oracle-private-key:latest,RPC_URL=oracle-rpc-url:latest,ADDRESS=oracle-address:latest,NETWORK=oracle-network:latest,COMMIT_OBLIGATION_ADDRESS=oracle-commit-obligation-address:latest,GIT_IDENTITY_REGISTRY_ADDRESS=oracle-git-identity-registry-address:latest,GITHUB_TOKEN=github-token:latest"
```

## Configuration

### GitHub Personal Access Token Setup

To clone private repositories or avoid GitHub rate limits, create a Personal Access Token:

1. Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Give it a descriptive name (e.g., "Git Escrows Oracle")
4. Select scopes:
   - For **public repos only**: No scopes needed (token still helps with rate limits)
   - For **private repos**: Select `repo` scope
5. Click "Generate token"
6. Copy the token (starts with `ghp_`)
7. Add it to Secret Manager as shown in Step 2 above

**Note**: The token is optional but recommended. Without it, you may encounter authentication errors when cloning GitHub repositories.

### Environment Variables

The following environment variables are required (set via Secret Manager):

- `PRIVATE_KEY`: Ethereum private key (0x...)
- `ADDRESS`: Ethereum address matching the private key
- `RPC_URL`: RPC endpoint URL
- `NETWORK`: Network name (base-sepolia, sepolia, mainnet)
- `COMMIT_OBLIGATION_ADDRESS`: CommitObligation contract address
- `GIT_IDENTITY_REGISTRY_ADDRESS`: GitIdentityRegistry contract address

Optional:
- `GITHUB_TOKEN`: GitHub Personal Access Token (recommended for private repos or to avoid rate limits)
- `WS_RPC_URL`: WebSocket RPC URL (for websocket transport)
- `TRANSPORT`: Transport type (http or websocket, default: http)
- `POLLING_INTERVAL`: Polling interval in ms (default: 1000)
- `TIMEOUT`: Test execution timeout in ms (default: 300000)
- `DEBUG`: Enable debug logging (true/false)

### Resource Configuration

Recommended Cloud Run settings:
- **Memory**: 2Gi (minimum for running tests)
- **CPU**: 2 vCPU
- **Timeout**: 900s (15 minutes)
- **Max Instances**: 10 (adjust based on load)
- **Min Instances**: 0 (for cost savings) or 1 (for always-on)

### Scaling Considerations

- The oracle processes one arbitration request at a time per instance
- Each arbitration can take up to 5 minutes (test execution)
- Set `min-instances=1` if you need low latency
- Set `min-instances=0` to save costs (cold start ~30s)

## Monitoring

### View Logs

```bash
gcloud run services logs read git-escrows-oracle --region=us-central1 --limit=50
```

### Monitor Metrics

```bash
# View service metrics in Cloud Console
# https://console.cloud.google.com/run/detail/us-central1/git-escrows-oracle/metrics
```

## Troubleshooting

### Container Fails to Start

1. Check logs: `gcloud run services logs read git-escrows-oracle --region=us-central1`
2. Verify secrets are accessible
3. Check that all required environment variables are set

### Tests Fail to Execute

1. Verify `clang` and `uv` are installed: Check Dockerfile
2. Check temp directory permissions: `/tmp/git-escrows` should be writable
3. Verify Git access: Repository URLs must be publicly accessible or provide `GITHUB_TOKEN` for private repos
4. If you see "could not read Username for 'https://github.com'": Set `GITHUB_TOKEN` secret in Secret Manager

### Out of Memory Errors

1. Increase memory allocation: `--memory=4Gi`
2. Check for memory leaks in test execution
3. Ensure cleanup is enabled: `--cleanup` flag

### Timeout Issues

1. Increase timeout: `--timeout=1800` (30 minutes)
2. Check test execution logs for slow operations
3. Verify network connectivity to Git repositories

## Security Considerations

1. **Private Keys**: Never commit private keys. Use Secret Manager.
2. **Network Access**: The oracle needs internet access to clone repositories.
3. **Resource Limits**: Set appropriate CPU/memory limits to prevent abuse.
4. **Secrets Rotation**: Regularly rotate secrets in Secret Manager.

## Cost Optimization

1. Use `min-instances=0` to scale to zero when idle
2. Set appropriate `max-instances` based on expected load
3. Monitor Cloud Run usage in Cloud Console
4. Consider using Cloud Scheduler for scheduled arbitration instead of continuous listening

## Local Testing

Test the Docker image locally before deploying:

```bash
# Build locally
docker build -t git-escrows-oracle:local .

# Run locally with environment variables
docker run -it --rm \
    -e PRIVATE_KEY=0x... \
    -e ADDRESS=0x... \
    -e RPC_URL=https://... \
    -e NETWORK=base-sepolia \
    -e COMMIT_OBLIGATION_ADDRESS=0x... \
    -e GIT_IDENTITY_REGISTRY_ADDRESS=0x... \
    -e GITHUB_TOKEN=ghp_... \
    git-escrows-oracle:local
```

## CI/CD Integration

Add to your CI/CD pipeline:

```yaml
# Example GitHub Actions workflow
name: Deploy Oracle
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: google-github-actions/setup-gcloud@v1
      - run: |
          gcloud builds submit --config=cloudbuild.yaml
```

## Support

For issues or questions:
1. Check Cloud Run logs
2. Review Dockerfile and startup script
3. Verify all dependencies are installed correctly

