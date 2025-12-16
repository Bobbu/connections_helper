#!/bin/bash
set -e

echo "=============================================="
echo "  Connections Helper - One-Click Deployment"
echo "=============================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI not installed${NC}"
    echo "Install: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js not installed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ All prerequisites met${NC}"
echo ""

# Get the directory where this script lives
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Install dependencies for fetch Lambda
echo "Installing fetch Lambda dependencies..."
cd "$SCRIPT_DIR/lambdas/fetch"
npm install --omit=dev
echo -e "${GREEN}✓ Fetch Lambda dependencies installed${NC}"

# Install dependencies for serve Lambda
echo "Installing serve Lambda dependencies..."
cd "$SCRIPT_DIR/lambdas/serve"
npm install --omit=dev
echo -e "${GREEN}✓ Serve Lambda dependencies installed${NC}"

# Install CDK dependencies
echo ""
echo "Installing CDK dependencies..."
cd "$SCRIPT_DIR/cdk"
npm install
echo -e "${GREEN}✓ CDK dependencies installed${NC}"

# Bootstrap CDK (if needed)
echo ""
echo "Bootstrapping CDK (if needed)..."
npx cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/us-east-1 2>/dev/null || true
echo -e "${GREEN}✓ CDK bootstrapped${NC}"

# Deploy
echo ""
echo "Deploying stack..."
echo -e "${YELLOW}Note: First deploy may take 5-10 minutes for certificate validation${NC}"
echo ""
npx cdk deploy --require-approval never

echo ""
echo "=============================================="
echo -e "${GREEN}  Deployment Complete!${NC}"
echo "=============================================="
echo ""
echo "Next steps:"
echo "1. Check the CloudFormation outputs above for the NameServers"
echo "2. Update your domain registrar (where anystupididea.com is registered)"
echo "   with the NS records shown above"
echo "3. Wait for DNS propagation (up to 48 hours)"
echo "4. Visit https://connections-helper.anystupididea.com"
echo ""
echo "To manually trigger a puzzle fetch:"
echo "  aws lambda invoke --function-name connections-helper-fetch --region us-east-1 /dev/stdout"
echo ""
