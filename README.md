# NYT Connections Helper

A web service that displays today's NYT Connections puzzle words with definitions and AI-generated cultural context to help you solve the puzzle.

**Live site:** https://connections-helper.anystupididea.com

## Features

- Daily puzzle words with dictionary definitions
- AI-generated cultural references (wordplay, slang, celebrity refs, alternate meanings)
- Today/Yesterday navigation
- Mobile-friendly responsive design
- Automatic daily updates at midnight ET

## Architecture

```
EventBridge (12:05 AM ET) → Fetch Lambda → DynamoDB
                                ↓
                           OpenAI API (cultural refs)

Route 53 → API Gateway → Serve Lambda → DynamoDB → HTML Response
S3 Bucket → CloudFront → Static Assets (favicon, og-image)
```

## Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js 18+
- AWS CDK CLI (`npm install -g aws-cdk`)
- OpenAI API key

## Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/Bobbu/connections_helper.git
   cd connections_helper
   ```

2. **Create OpenAI API key secret in AWS Secrets Manager**
   ```bash
   aws secretsmanager create-secret \
     --name connections-helper/openai-api-key \
     --secret-string "sk-your-api-key-here" \
     --region us-east-1
   ```

3. **Deploy to AWS**
   ```bash
   ./deploy.sh
   ```

That's it! The deploy script handles all dependencies and CDK deployment.

## Project Structure

```
connections_helper/
├── deploy.sh                 # One-click deployment script
├── lambdas/
│   ├── fetch/                # Fetches puzzle + definitions + AI cultural refs
│   │   ├── index.js
│   │   └── cultural-refs.js  # Fallback hardcoded references
│   └── serve/                # Serves HTML from DynamoDB cache
│       └── index.js
├── cdk/                      # AWS CDK infrastructure
│   └── lib/connections-helper-stack.ts
└── assets/icons/             # Favicons and social images
```

## Manual Commands

```bash
# Trigger a puzzle fetch manually
aws lambda invoke --function-name connections-helper-fetch --region us-east-1 /dev/stdout

# View recent logs
aws logs tail /aws/lambda/connections-helper-fetch --follow

# CDK commands
cd cdk && npm run cdk diff    # Preview changes
cd cdk && npm run cdk deploy  # Deploy stack
```

## Cost

- **OpenAI:** ~$0.03/month (one GPT-4o-mini call per day)
- **AWS:** Minimal (Lambda free tier, DynamoDB on-demand, small S3/CloudFront usage)

## License

MIT
