#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Git Deal Contract Deployment Script${NC}"
echo "========================================"

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${RED}Error: .env file not found${NC}"
    echo "Please create a .env file with the following variables:"
    echo "PRIVATE_KEY=your_private_key_here"
    echo "SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/your_project_id"
    echo "ETHERSCAN_API_KEY=your_etherscan_api_key"
    exit 1
fi

# Source environment variables
source .env

# Validate required environment variables
if [ -z "$PRIVATE_KEY" ]; then
    echo -e "${RED}Error: PRIVATE_KEY not set in .env file${NC}"
    exit 1
fi

if [ -z "$SEPOLIA_RPC_URL" ]; then
    echo -e "${RED}Error: SEPOLIA_RPC_URL not set in .env file${NC}"
    exit 1
fi

# Check if forge is installed
if ! command -v forge &> /dev/null; then
    echo -e "${RED}Error: Foundry forge not found${NC}"
    echo "Please install Foundry: https://book.getfoundry.sh/getting-started/installation"
    exit 1
fi

echo -e "${YELLOW}Pre-deployment checks...${NC}"

# Get deployer address
# Handle private key with or without 0x prefix
if [[ $PRIVATE_KEY == 0x* ]]; then
    DEPLOYER_ADDRESS=$(cast wallet address --private-key $PRIVATE_KEY)
else
    DEPLOYER_ADDRESS=$(cast wallet address --private-key 0x$PRIVATE_KEY)
fi
echo "Deployer address: $DEPLOYER_ADDRESS"

# Check balance
BALANCE=$(cast balance $DEPLOYER_ADDRESS --rpc-url $SEPOLIA_RPC_URL)
BALANCE_ETH=$(cast to-unit $BALANCE ether)
echo "Deployer balance: $BALANCE_ETH ETH"

# Check if balance is sufficient (minimum 0.01 ETH recommended)
BALANCE_WEI=$(echo $BALANCE | sed 's/[^0-9]*//g')
MIN_BALANCE="10000000000000000" # 0.01 ETH in wei

if [ "$BALANCE_WEI" -lt "$MIN_BALANCE" ]; then
    echo -e "${YELLOW}Warning: Low balance. Recommended minimum: 0.01 ETH${NC}"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo -e "${GREEN}Pre-deployment checks passed${NC}"
echo

# Compile contracts
echo -e "${YELLOW}Compiling contracts...${NC}"
forge build
if [ $? -ne 0 ]; then
    echo -e "${RED}Compilation failed${NC}"
    exit 1
fi
echo -e "${GREEN}Compilation successful${NC}"

# Run deployment
echo -e "${YELLOW}Deploying to Sepolia...${NC}"
DEPLOY_OUTPUT=$(forge script script/DeploySepolia.s.sol:DeploySepoliaScript \
    --rpc-url $SEPOLIA_RPC_URL \
    --broadcast \
    --verify \
    --etherscan-api-key $ETHERSCAN_API_KEY \
    -vvvv 2>&1)

DEPLOY_EXIT_CODE=$?
echo "$DEPLOY_OUTPUT"

# Check if deployment was successful even if script failed (due to file write issues)
if [ $DEPLOY_EXIT_CODE -eq 0 ] || echo "$DEPLOY_OUTPUT" | grep -q "GitIdentityRegistry deployed at:"; then
    echo -e "${GREEN}Deployment successful!${NC}"
    
    # Extract contract addresses from output
    GIT_REGISTRY=$(echo "$DEPLOY_OUTPUT" | grep "GitIdentityRegistry deployed at:" | grep -o '0x[a-fA-F0-9]\{40\}' | head -1)
    COMMIT_OBLIGATION=$(echo "$DEPLOY_OUTPUT" | grep "CommitObligation deployed at:" | grep -o '0x[a-fA-F0-9]\{40\}' | head -1)
    DEPLOYER=$(echo "$DEPLOY_OUTPUT" | grep "Deployer address:" | grep -o '0x[a-fA-F0-9]\{40\}' | head -1)
    BLOCK_NUMBER=$(echo "$DEPLOY_OUTPUT" | grep "Block:" | sed 's/.*Block: //' | grep -o '[0-9]\+' | head -1)
    
    # Create deployments directory if it doesn't exist
    mkdir -p deployments
    
    # Only create deployment file if we successfully extracted addresses
    if [ ! -z "$GIT_REGISTRY" ] && [ ! -z "$COMMIT_OBLIGATION" ]; then
        # Create deployment info file
        cat > deployments/sepolia.json << EOF
{
  "gitIdentityRegistry": "$GIT_REGISTRY",
  "commitObligation": "$COMMIT_OBLIGATION",
  "deployer": "$DEPLOYER",
  "blockNumber": $BLOCK_NUMBER,
  "timestamp": $(date +%s),
  "easRegistry": "0xC2679fBD37d54388Ce493F1DB75320D236e1815e",
  "schemaRegistry": "0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0",
  "network": "sepolia",
  "chainId": 11155111
}
EOF
        echo -e "${GREEN}Deployment details saved to deployments/sepolia.json${NC}"
    else
        echo -e "${YELLOW}Warning: Could not extract all contract addresses from output${NC}"
        echo "Please check the deployment output above for contract addresses"
    fi
    
    echo
    echo -e "${GREEN}Deployment completed successfully!${NC}"
    echo "  - broadcast/DeploySepolia.s.sol/ (Foundry broadcast logs)"
    echo
    echo -e "${GREEN}Contract verification will be processed by Etherscan${NC}"
    echo "You can check the status at: https://sepolia.etherscan.io/"
    echo
    if [ ! -z "$GIT_REGISTRY" ] && [ ! -z "$COMMIT_OBLIGATION" ]; then
        echo -e "${GREEN}Deployed Contract Addresses:${NC}"
        echo "  GitIdentityRegistry: $GIT_REGISTRY"
        echo "  CommitObligation: $COMMIT_OBLIGATION"
        echo "  View on Etherscan:"
        echo "    - https://sepolia.etherscan.io/address/$GIT_REGISTRY"
        echo "    - https://sepolia.etherscan.io/address/$COMMIT_OBLIGATION"
    fi
else
    echo -e "${RED}Deployment failed${NC}"
    echo "Check the error messages above for details."
    exit 1
fi