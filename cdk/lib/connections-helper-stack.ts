import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as path from 'path';
import { Construct } from 'constructs';

export interface ConnectionsHelperStackProps extends cdk.StackProps {
  domainName: string;
  subdomain: string;
}

export class ConnectionsHelperStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ConnectionsHelperStackProps) {
    super(scope, id, props);

    const fullDomain = `${props.subdomain}.${props.domainName}`;

    // DynamoDB Table for puzzle cache
    const puzzleTable = new dynamodb.Table(this, 'PuzzleTable', {
      tableName: 'connections-helper-puzzles',
      partitionKey: {
        name: 'puzzle_date',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev; change to RETAIN for prod
      timeToLiveAttribute: 'ttl',
    });

    // Route 53 Hosted Zone - use existing zone (Z6ED78QGBFL6M)
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: 'Z6ED78QGBFL6M',
      zoneName: props.domainName,
    });

    // ACM Certificate for the subdomain
    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: fullDomain,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // S3 Bucket for static assets (favicons, og-image, etc.)
    const assetsBucket = new s3.Bucket(this, 'AssetsBucket', {
      bucketName: `${props.subdomain}-${props.domainName.replace(/\./g, '-')}-assets`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // CloudFront distribution for static assets
    const assetsDistribution = new cloudfront.Distribution(this, 'AssetsDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(assetsBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      comment: 'Connections Helper Static Assets',
    });

    // Deploy static assets to S3
    new s3deploy.BucketDeployment(this, 'DeployAssets', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../assets/icons'))],
      destinationBucket: assetsBucket,
      distribution: assetsDistribution,
      distributionPaths: ['/*'],
    });

    const assetsUrl = `https://${assetsDistribution.distributionDomainName}`;

    // Reference existing OpenAI API key secret
    const openaiSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'OpenAISecret',
      'connections-helper/openai-api-key'
    );

    // Fetch Lambda (standard Node.js - uses NYT API, no Puppeteer needed)
    const fetchLambda = new lambda.Function(this, 'FetchLambda', {
      functionName: 'connections-helper-fetch',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/fetch')),
      memorySize: 256,
      timeout: cdk.Duration.seconds(60), // Increased for OpenAI API call
      environment: {
        TABLE_NAME: puzzleTable.tableName,
        OPENAI_SECRET_NAME: 'connections-helper/openai-api-key',
      },
      architecture: lambda.Architecture.ARM_64, // Cost efficient
    });

    puzzleTable.grantWriteData(fetchLambda);
    openaiSecret.grantRead(fetchLambda);

    // Serve Lambda (standard Node.js)
    const serveLambda = new lambda.Function(this, 'ServeLambda', {
      functionName: 'connections-helper-serve',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/serve')),
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        TABLE_NAME: puzzleTable.tableName,
        ASSETS_URL: assetsUrl,
      },
      architecture: lambda.Architecture.ARM_64,
    });

    puzzleTable.grantReadData(serveLambda);

    // EventBridge Scheduler — runs at 12:05 AM America/New_York year-round.
    // Using the Scheduler service (not the older Rules API) so the schedule
    // expression can carry a timezone and stays put across DST transitions.
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    fetchLambda.grantInvoke(schedulerRole);

    new scheduler.CfnSchedule(this, 'FetchSchedule', {
      name: 'connections-helper-daily-fetch',
      flexibleTimeWindow: { mode: 'OFF' },
      scheduleExpression: 'cron(5 0 * * ? *)',
      scheduleExpressionTimezone: 'America/New_York',
      target: {
        arn: fetchLambda.functionArn,
        roleArn: schedulerRole.roleArn,
      },
    });

    // API Gateway for serving HTML (static assets now on S3/CloudFront)
    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'connections-helper-api',
      description: 'NYT Connections Helper API',
      domainName: {
        domainName: fullDomain,
        certificate: certificate,
        endpointType: apigateway.EndpointType.EDGE,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'OPTIONS'],
      },
    });

    // Lambda integration for serve Lambda
    const rootIntegration = new apigateway.LambdaIntegration(serveLambda);

    // GET / - Today's puzzle
    api.root.addMethod('GET', rootIntegration);

    // GET /{date} - Historical puzzle
    const dateResource = api.root.addResource('{date}');
    dateResource.addMethod('GET', rootIntegration);

    // Route 53 A Record pointing to API Gateway
    new route53.ARecord(this, 'ApiAliasRecord', {
      zone: hostedZone,
      recordName: props.subdomain,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.ApiGateway(api)
      ),
    });

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: `https://${fullDomain}`,
      description: 'Connections Helper URL',
    });

    new cdk.CfnOutput(this, 'AssetsUrl', {
      value: assetsUrl,
      description: 'Static Assets CloudFront URL',
    });
  }
}
