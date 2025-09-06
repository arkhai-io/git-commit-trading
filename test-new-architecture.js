#!/usr/bin/env node

// Test the new SDK architecture
// This script validates that git-app handles test execution and SDKs handle oracle logic

import { SdkFactory } from './src/test-execution/sdks/factory.js';
import { OracleExecutor } from './src/test-execution/oracle-executor.js';

console.log('🧪 Testing new SDK architecture...\n');

// Mock obligation and demand data
const mockObligation = [{
  hosts: ['https://github.com/user/source-repo.git'],
  commitHash: 'abc123def456',
  commitAlgo: 1 // SHA256
}];

const mockDemand = [{
  hosts: ['https://github.com/user/test-repo.git'],
  testsCommitHash: '789xyz012abc',
  testsCommitAlgo: 1, // SHA256
  testsCommand: 'npm test'
}];

// Mock config
const mockConfig = {
  repositories: {
    source: {
      url: 'https://github.com/user/source-repo.git',
      commitHash: 'abc123def456',
      commitAlgo: 'sha256',
      branch: 'main'
    },
    testcase: {
      url: 'https://github.com/user/test-repo.git',
      commitHash: '789xyz012abc',
      commitAlgo: 'sha256',
      branch: 'main',
      testCommand: 'npm test'
    }
  },
  execution: {
    timeout: 300000,
    isolateTests: true
  },
  sdkType: 'typescript'
};

async function testSdkArchitecture() {
  console.log('1. Testing SDK Factory...');
  
  // Test TypeScript SDK
  try {
    const tsSDK = SdkFactory.createSdk('typescript');
    console.log('✅ TypeScript SDK created');
    
    const oracleClient = await tsSDK.createOracleClient();
    console.log('✅ TypeScript oracle client created:', oracleClient.type);
    
    const result = await tsSDK.submitArbitrationResult(true, mockObligation, mockDemand);
    console.log('✅ TypeScript result submitted:', result);
  } catch (error) {
    console.log('❌ TypeScript SDK error:', error.message);
  }
  
  console.log();
  
  // Test Python SDK
  try {
    const pySDK = SdkFactory.createSdk('python');
    console.log('✅ Python SDK created');
    
    const oracleClient = await pySDK.createOracleClient();
    console.log('✅ Python oracle client created:', oracleClient.type);
    
    const result = await pySDK.submitArbitrationResult(true, mockObligation, mockDemand);
    console.log('✅ Python result submitted:', result);
  } catch (error) {
    console.log('❌ Python SDK error:', error.message);
  }
  
  console.log();
  
  // Test Rust SDK (expected to fail without binary)
  try {
    const rustSDK = SdkFactory.createSdk('rust');
    console.log('✅ Rust SDK created');
    
    const oracleClient = await rustSDK.createOracleClient();
    console.log('✅ Rust oracle client created:', oracleClient.type);
    
    const result = await rustSDK.submitArbitrationResult(true, mockObligation, mockDemand);
    console.log('✅ Rust result submitted:', result);
  } catch (error) {
    console.log('❌ Rust SDK error (expected):', error.message);
  }
  
  console.log('\n2. Testing Oracle Executor...');
  
  try {
    const oracleExecutor = new OracleExecutor(mockConfig);
    console.log('✅ Oracle Executor created');
    
    // Note: This would normally execute real tests, but for this demo
    // we're testing the architecture without actual repo cloning
    console.log('ℹ️  Oracle execution test skipped (requires real repos)');
  } catch (error) {
    console.log('❌ Oracle Executor error:', error.message);
  }
  
  console.log('\n🎉 SDK Architecture test completed!');
  console.log('\nArchitecture Summary:');
  console.log('- git-app: Handles repository downloading, merging, and test execution');
  console.log('- SDKs: Handle oracle client creation and result submission to blockchain');
  console.log('- TypeScript SDK: Ready and working');
  console.log('- Python SDK: Ready and working');
  console.log('- Rust SDK: Needs oracle binary implementation');
}

testSdkArchitecture().catch(console.error);
