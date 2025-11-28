#!/bin/bash
set -e

# Deployment helper script for Git Escrows Oracle
# Usage: ./scripts/deploy.sh [options]

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-us-central1}"
REPO_NAME="${REPO_NAME:-oracle-images}"
SERVICE_NAME="${SERVICE_NAME:-git-escrows-oracle}"
MEMORY="${MEMORY:-2Gi}"
CPU="${CPU:-2}"
TIMEOUT="${TIMEOUT:-900}"
MAX_INSTANCES="${MAX_INSTANCES:-10}"
MIN_INSTANCES="${MIN_INSTANCES:-0}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

function print_usage() {
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  --project-id PROJECT_ID    Google Cloud Project ID (required)"
    echo "  --region REGION            Region for deployment (default: us-central1)"
    echo "  --repo-name REPO_NAME      Artifact Registry repository name (default: oracle-images)"
    echo "  --service-name SERVICE     Cloud Run service name (default: git-escrows-oracle)"
    echo "  --memory MEMORY            Memory allocation (default: 2Gi)"
    echo "  --cpu CPU                  CPU allocation (default: 2)"
    echo "  --timeout TIMEOUT          Timeout in seconds (default: 900)"
    echo "  --max-instances MAX        Maximum instances (default: 10)"
    echo "  --min-instances MIN        Minimum instances (default: 0)"
    echo "  --help                     Show this help message"
    echo ""
    echo "Environment variables:"
    echo "  PROJECT_ID, REGION, REPO_NAME, SERVICE_NAME, MEMORY, CPU, TIMEOUT, MAX_INSTANCES, MIN_INSTANCES"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --project-id)
            PROJECT_ID="$2"
            shift 2
            ;;
        --region)
            REGION="$2"
            shift 2
            ;;
        --repo-name)
            REPO_NAME="$2"
            shift 2
            ;;
        --service-name)
            SERVICE_NAME="$2"
            shift 2
            ;;
        --memory)
            MEMORY="$2"
            shift 2
            ;;
        --cpu)
            CPU="$2"
            shift 2
            ;;
        --timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        --max-instances)
            MAX_INSTANCES="$2"
            shift 2
            ;;
        --min-instances)
            MIN_INSTANCES="$2"
            shift 2
            ;;
        --help)
            print_usage
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            print_usage
            exit 1
            ;;
    esac
done

# Validate required parameters
if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}Error: PROJECT_ID is required${NC}"
    echo "Set it via --project-id flag or PROJECT_ID environment variable"
    print_usage
    exit 1
fi

echo -e "${GREEN}Deploying Git Escrows Oracle to Cloud Run${NC}"
echo "Project ID: $PROJECT_ID"
echo "Region: $REGION"
echo "Service: $SERVICE_NAME"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}Error: gcloud CLI is not installed${NC}"
    exit 1
fi

# Set the project
echo -e "${YELLOW}Setting GCP project...${NC}"
gcloud config set project "$PROJECT_ID"

# Submit build (specify region to ensure Cloud Build runs in the correct region)
echo -e "${YELLOW}Submitting Cloud Build...${NC}"
gcloud builds submit \
    --region="$REGION" \
    --config=cloudbuild.yaml \
    --substitutions=_REGION="$REGION",_REPO_NAME="$REPO_NAME",_SERVICE_NAME="$SERVICE_NAME",_MEMORY="$MEMORY",_CPU="$CPU",_TIMEOUT="$TIMEOUT",_MAX_INSTANCES="$MAX_INSTANCES",_MIN_INSTANCES="$MIN_INSTANCES"

echo -e "${GREEN}Deployment complete!${NC}"
echo ""
echo "View logs:"
echo "  gcloud run services logs read $SERVICE_NAME --region=$REGION --limit=50"
echo ""
echo "View service:"
echo "  https://console.cloud.google.com/run/detail/$REGION/$SERVICE_NAME"

