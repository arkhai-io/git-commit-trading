#!/usr/bin/env node
import { SdkFactory } from './src/test-execution/sdks/index.js';

// Test data matching the format expected by the SDKs
const testObligation = [{
  commitHash: "14acbbd4b4795dc5a8178540e32e1aa9661867ea",
  commitAlgo: 0,
  hosts: ["https://github.com/thinhnx-var/solution-repo-bob.git"]
}];

const testDemand = [{
  testsCommitHash: "ab940eceae6702e05b9c03765b7407a054ea84c9",
  testsCommand: "npm test",
  testsCommitAlgo: 0,
  hosts: ["https://github.com/thinhnx-var/testcase-repo-alice.git"]
}];

async function testAllSdks() {
  console.log('🧪 Testing Multi-SDK Architecture\n');
  
  const sdkTypes = ['typescript', 'rust', 'python'];
  
  for (const sdkType of sdkTypes) {
    try {
      console.log(`Testing ${sdkType.toUpperCase()} SDK:`);
      
      // Create SDK instance
      const sdk = SdkFactory.createSdk(sdkType);
      
      // Validate SDK
      const isValid = await sdk.validateSdk();
      if (!isValid) {
        console.log(`  ❌ SDK not available`);
        continue;
      }
      
      console.log(`  ✅ SDK available`);
      
      // Test arbitration (for TypeScript it will run real tests, for others it's placeholder)
      if (sdkType === 'typescript') {
        console.log(`  🧪 Running real test execution...`);
        const result = await sdk.executeArbitration(testObligation, testDemand);
        console.log(`  📊 Result: ${result ? 'PASSED' : 'FAILED'}`);
      } else {
        console.log(`  🧪 Running placeholder arbitration...`);
        const result = await sdk.executeArbitration(testObligation, testDemand);
        console.log(`  📊 Result: ${result ? 'PASSED' : 'FAILED'}`);
      }
      
      console.log();
      
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      console.log();
    }
  }
}

// Run the test
testAllSdks().catch(console.error);
