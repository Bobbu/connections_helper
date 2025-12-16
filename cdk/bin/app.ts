#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ConnectionsHelperStack } from '../lib/connections-helper-stack';

const app = new cdk.App();

const domainName = app.node.tryGetContext('domainName') || 'anystupididea.com';
const subdomain = app.node.tryGetContext('subdomain') || 'connections-helper';

new ConnectionsHelperStack(app, 'ConnectionsHelperStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1', // Required for ACM certificates with API Gateway
  },
  domainName,
  subdomain,
});
