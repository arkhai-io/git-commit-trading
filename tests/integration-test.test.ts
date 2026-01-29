import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parseAbiParameters, encodeAbiParameters } from "viem";
import { setupTest } from "./utils/setup";
import type { TestContext } from "alkahest-ts";
import { CommitAlgo, type CommitObligationData } from "../src/clients/commitObligation";
import { KeyType, createGitKeyClaim } from "../src/clients/gitIdentityRegistry";
import { GitTestExecution } from "../src/test-execution/";
import { extractSSHKeyMaterial } from "../src/utils/gitUtils";
import { GitVerificationService } from "../src/services/verificationService";
import { 
  verifyCommitSignature, 
  generateSigningMessage, 
  verifyGitKeyClaimSignature, 
  generateSSHSignature,
  generatePGPSignature
} from "../src/utils/sshSignatureUtils";
import IntegrationTestHelpers from "./utils/integration-helpers";
import chalk from 'chalk';

// Type for extended client with commitObligation and gitIdentityRegistry
type ExtendedClient = Awaited<ReturnType<typeof setupTest>>['aliceClient'];

// Integration test configuration interface
interface IntegrationConfig {
  blockchain: {
    rpcUrl: string;
    chainId: number;
  };
  keys: {
    preferredKeyType: "pgp" | "ssh" | "both";
    pgp: {
      publicKeyPath: string;
      privateKeyPath: string;
      keyId: string;
      passphrase: string;
    };
    ssh: {
      publicKeyPath: string;
      privateKeyPath: string;
      keyType: string;
    };
  };
  repositories: {
    alice: {
      name: string;
      url: string;
      testsCommitHash: string;
      testsCommitAlgo: number;
      localClonePath: string;
    };
    bob: {
      name: string;
      url: string;
      ssh: {
        solutionCommitHash: string;
        solutionCommitAlgo: number;
      };
      pgp: {
        solutionCommitHash: string;
        solutionCommitAlgo: number;
      };
      localClonePath: string;
    };
  };
  escrow: {
    tokenAmount: string;
    expirationHours: number;
  };
  server: {
    pollingInterval: number;
    timeout: number;
    skipKeyVerification: boolean;
    useGitVerifyCommit: boolean;
  };
  test: {
    waitTimeMs: number;
    maxRetries: number;
    cleanupAfterTest: boolean;
    enableDetailedLogs: boolean;
  };
}

// Global client references for use in helper functions
let globalAliceClient: ExtendedClient;
let globalBobClient: ExtendedClient;
let globalArbiterClient: ExtendedClient;

describe("🚀 Complete Integration Test - Real Keys & Commits", () => {
  let testContext: TestContext;
  let alice: `0x${string}`;
  let bob: `0x${string}`;
  let oracle: `0x${string}`;
  let aliceClient: any;
  let bobClient: any;
  let arbiterClient: any;
  let commitObligationAddress: `0x${string}`;
  let gitIdentityRegistryAddress: `0x${string}`;
  let config: IntegrationConfig;

  beforeAll(async () => {
    console.log(chalk.blue("🔧 Setting up integration test environment..."));
    
    // Load real configuration
    const configPath = resolve(__dirname, "../integration-test-config.json");
    if (!existsSync(configPath)) {
      throw new Error(`Configuration file not found: ${configPath}. Please create and populate integration-test-config.json`);
    }

    config = JSON.parse(readFileSync(configPath, "utf-8")) as IntegrationConfig;
    console.log(chalk.green("✅ Configuration loaded"));

    // Validate critical configuration
    validateConfiguration(config);
    console.log(chalk.green("✅ Configuration validated"));

    // Setup test environment
    const setup = await setupTest();
    testContext = setup.testContext;
    aliceClient = setup.aliceClient;
    bobClient = setup.bobClient;

    // Set global client references
    globalAliceClient = aliceClient;
    globalBobClient = bobClient;

    // Extend charlie client as oracle/arbiter
    arbiterClient = testContext.charlie.client.extend((client: any) => ({
      commitObligation: setup.aliceClient.commitObligation,
      gitIdentityRegistry: setup.aliceClient.gitIdentityRegistry,
    }));

    globalArbiterClient = arbiterClient;

    alice = testContext.alice.address;
    bob = testContext.bob.address;
    oracle = testContext.charlie.address;
    commitObligationAddress = setup.commitObligationAddress;
    gitIdentityRegistryAddress = setup.gitIdentityRegistryAddress;

    console.log(chalk.green("✅ Test environment ready"));
    console.log(chalk.gray(`   Alice: ${alice}`));
    console.log(chalk.gray(`   Bob: ${bob}`));
    console.log(chalk.gray(`   Oracle: ${oracle}`));
  });



  test("Complete End-to-End Flow with Real Keys and Commits", async () => {
    const keyType = config.keys.preferredKeyType;
    
    if (keyType === "both") {
      console.log(chalk.blue("\n🎯 Starting Complete Integration Test - BOTH KEY TYPES"));
      console.log(chalk.blue("Testing with both PGP and SSH keys with actual Git commits"));
      
      // Test with PGP first
      console.log(chalk.magenta("\n" + "=".repeat(60)));
      console.log(chalk.magenta("🔑 TESTING WITH PGP KEYS"));
      console.log(chalk.magenta("=".repeat(60)));
      await runTestWithKeyType("pgp", config, testContext, commitObligationAddress);
      
      // Test with SSH second
      console.log(chalk.magenta("\n" + "=".repeat(60)));
      console.log(chalk.magenta("🔑 TESTING WITH SSH KEYS"));  
      console.log(chalk.magenta("=".repeat(60)));
      await runTestWithKeyType("ssh", config, testContext, commitObligationAddress);
      
      console.log(chalk.blue("\n🎉 Both Key Types Integration Test Completed Successfully!"));
      console.log(chalk.green("✅ Complete flow verified with both PGP and SSH keys"));
    } else {
      console.log(chalk.blue("\n🎯 Starting Complete Integration Test"));
      console.log(chalk.blue(`Testing with real ${keyType.toUpperCase()} keys and actual Git commits`));
      
      await runTestWithKeyType(keyType, config, testContext, commitObligationAddress);
      
      console.log(chalk.blue("\n🎉 Integration Test Completed Successfully!"));
      console.log(chalk.green("✅ Complete flow verified with real keys and commits"));
    }
  }, 120000); // 2 minute timeout for complete flow (both modes might take longer)
});

async function runTestWithKeyType(keyType: "pgp" | "ssh", config: IntegrationConfig, testContext: TestContext, commitObligationAddress: `0x${string}`) {
  // Step 1: Load real keys and register Bob's identity
  console.log(chalk.blue("\n📋 Step 1: Load Real Keys and Register Bob's Identity"));
  
  // Create a temporary config for this specific key type
  const tempConfig = { ...config, keys: { ...config.keys, preferredKeyType: keyType } };
  
  const keyData = await loadRealKeys(tempConfig);
  
  // Log signature configuration details
  console.log(chalk.cyan("🔐 Signature Configuration Details:"));
  console.log(chalk.gray(`   Key Type: ${keyType.toUpperCase()}`));
  if (keyType === "pgp") {
    console.log(chalk.gray(`   PGP Key ID: ${config.keys.pgp.keyId}`));
    console.log(chalk.gray(`   PGP Public Key: ${config.keys.pgp.publicKeyPath}`));
    console.log(chalk.gray(`   PGP Private Key: ${config.keys.pgp.privateKeyPath}`));
    console.log(chalk.gray(`   Has Passphrase: ${config.keys.pgp.passphrase ? 'Yes' : 'No'}`));
  } else {
    console.log(chalk.gray(`   SSH Key Type: ${config.keys.ssh.keyType}`));
    console.log(chalk.gray(`   SSH Public Key: ${config.keys.ssh.publicKeyPath}`));
    console.log(chalk.gray(`   SSH Private Key: ${config.keys.ssh.privateKeyPath}`));
  }
  console.log(chalk.gray(`   Key Material Length: ${keyData.publicKeyMaterial.length} characters`));
  
  console.log(chalk.green(`✅ Loaded ${keyType.toUpperCase()} key material`));

  // Get the global clients that were set up in beforeAll
  const registrationResult = await registerBobKey(globalBobClient, keyData, testContext.bob.address, tempConfig);
  console.log(chalk.green("✅ Bob's key registered successfully"));

  // Verify registration (only for single key type tests)
  if (config.keys.preferredKeyType !== "both") {
    const registeredClaim = await globalBobClient.gitIdentityRegistry.getLatestKeyClaim(testContext.bob.address);
    console.log(chalk.blue(`🔍 Expected key: ${keyData.publicKeyMaterial}`));
    console.log(chalk.blue(`🔍 Registered key: ${registeredClaim?.publicKey}`));
    expect(registeredClaim?.publicKey).toBe(keyData.publicKeyMaterial);
    console.log(chalk.green("✅ Key registration verified"));
  } else {
    // In "both" mode, the second key registration will overwrite the first one
    // This is expected behavior - we'll verify the key works during arbitration instead
    console.log(chalk.yellow("⚠️ Skipping key verification in 'both' mode (latest key overwrites previous)"));
  }

  // Step 2: Alice creates escrow challenge
  console.log(chalk.blue("\n📋 Step 2: Alice Creates Escrow Challenge"));
  
  const escrowResult = await createAliceEscrow(globalAliceClient, config, testContext.charlie.address, testContext);
  console.log(chalk.green("✅ Alice's escrow challenge created"));
  console.log(chalk.gray(`   Escrow UID: ${escrowResult.attested.uid}`));

  // Step 3: Bob submits fulfillment
  console.log(chalk.blue("\n📋 Step 3: Bob Submits Solution Fulfillment"));
  
  const fulfillmentResult = await createBobFulfillment(globalBobClient, config, escrowResult.attested.uid, keyType);
  console.log(chalk.green("✅ Bob's fulfillment submitted"));
  console.log(chalk.gray(`   Fulfillment UID: ${fulfillmentResult.attested.uid}`));

  // Wait for blockchain state
  await new Promise(resolve => setTimeout(resolve, config.test.waitTimeMs));

  // Step 4: Oracle arbitration with real test execution
  console.log(chalk.blue("\n📋 Step 4: Oracle Arbitration with Real Test Execution"));
  
  let arbitrationCompleted = false;
  let arbitrationResult = false;

  const { unwatch } = await globalArbiterClient.arbiters.general.trustedOracle.arbitrateMany(
  async ({attestation, demand}) => {
      console.log("Arbitrating ", attestation, demand);
      const obligation = globalArbiterClient.commitObligation.decode(
                    attestation.data
                );
                console.log("Obligation:", obligation);
      console.log(chalk.yellow("\n🏛️ Oracle Arbitration Process Starting..."));
      
      const result = await performCompleteArbitration(
        obligation, 
        demand, 
        config, 
        keyData, 
        globalArbiterClient
      );

      arbitrationResult = result;
      arbitrationCompleted = true;
      return result;
    },
    {
      mode:"past",
      onAfterArbitrate: async (decision: any) => {
      console.log(chalk.green(`\n✅ Arbitration Decision: ${decision.decision ? 'APPROVED' : 'REJECTED'}`));
      console.log(chalk.gray(`   Transaction Hash: ${decision.hash}`));
    },
    pollingInterval: config.server.pollingInterval,
  });

  // Wait for arbitration to complete
  const maxWaitTime = config.server.timeout;
  const checkInterval = 1000;
  let elapsedTime = 0;

  while (!arbitrationCompleted && elapsedTime < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    elapsedTime += checkInterval;
  }

  unwatch();

  if (!arbitrationCompleted) {
    throw new Error(`Arbitration did not complete within ${maxWaitTime}ms`);
  }

  // Verify arbitration completed
  expect(arbitrationCompleted).toBeTruthy();
  console.log(chalk.green(`✅ Arbitration completed: ${arbitrationResult ? 'PASSED' : 'FAILED'}`));

  // Step 5: Verify reward collection (if tests passed)
  if (arbitrationResult) {
    console.log(chalk.blue("\n📋 Step 5: Bob Collects Reward"));
    
    const collectionHash = await globalBobClient.erc20.escrow.nonTierable.collect(
      escrowResult.attested.uid,
      fulfillmentResult.attested.uid,
    );

    expect(collectionHash).toBeTruthy();
    console.log(chalk.green("✅ Bob successfully collected the escrow reward"));
    console.log(chalk.gray(`   Collection Hash: ${collectionHash}`));
  } else {
    console.log(chalk.yellow("⚠️ Tests failed - Bob cannot collect reward"));
    console.log(chalk.red("\n❌ Integration Test Failed!"));
    console.log(chalk.red("✗ Test execution failed - fix the solution or test configuration"));
    
    // Fail the test when arbitration/test execution fails
    throw new Error("Test execution failed during arbitration - solution does not pass the tests");
  }
}

// Helper Functions

function expandPath(filePath: string): string {
  if (filePath.startsWith('~')) {
    const os = require('os');
    return filePath.replace('~', os.homedir());
  }
  return filePath;
}

function validateConfiguration(config: IntegrationConfig): void {
  // Validate the preferred key type exists and files are present
  const keyType = config.keys.preferredKeyType;
  
  if (keyType !== "pgp" && keyType !== "ssh" && keyType !== "both") {
    throw new Error(`Invalid preferredKeyType: ${keyType}. Must be 'pgp', 'ssh', or 'both'`);
  }

  let requiredPaths: string[] = [];
  
  if (keyType === "pgp") {
    requiredPaths = [
      config.keys.pgp.publicKeyPath,
      config.keys.pgp.privateKeyPath,
    ];
  } else if (keyType === "ssh") {
    requiredPaths = [
      config.keys.ssh.publicKeyPath,
      config.keys.ssh.privateKeyPath,
    ];
  } else if (keyType === "both") {
    // Validate both PGP and SSH keys when using "both" mode
    requiredPaths = [
      config.keys.pgp.publicKeyPath,
      config.keys.pgp.privateKeyPath,
      config.keys.ssh.publicKeyPath,
      config.keys.ssh.privateKeyPath,
    ];
  }

  for (const path of requiredPaths) {
    const expandedPath = expandPath(path);
    const resolvedPath = path.startsWith('/') ? expandedPath : resolve(__dirname, "..", expandedPath);
    if (!existsSync(resolvedPath)) {
      throw new Error(`Required ${keyType.toUpperCase()} key file not found: ${path} (resolved to: ${resolvedPath}). Please follow INTEGRATION_TEST_SETUP.md`);
    }
  }

  if (config.repositories.alice.testsCommitHash === "YOUR_ALICE_TEST_COMMIT_HASH_HERE") {
    throw new Error("Please update integration-test-config.json with your real commit hashes");
  }

  if (config.repositories.bob.ssh.solutionCommitHash === "FILL_WITH_SSH_SIGNED_COMMIT_HASH") {
    throw new Error("Please update integration-test-config.json with your real SSH-signed commit hash");
  }

  if (config.repositories.bob.pgp.solutionCommitHash === "FILL_WITH_PGP_SIGNED_COMMIT_HASH") {
    throw new Error("Please update integration-test-config.json with your real PGP-signed commit hash");
  }
}

async function loadRealKeys(config: IntegrationConfig) {
  const keyType = config.keys.preferredKeyType;
  
  if (keyType === "pgp") {
    // Use PGP keys
    const pgpPublicKeyPath = config.keys.pgp.publicKeyPath.startsWith('/') ? 
      expandPath(config.keys.pgp.publicKeyPath) : 
      resolve(__dirname, "..", config.keys.pgp.publicKeyPath);
    const pgpPublicKey = readFileSync(pgpPublicKeyPath, "utf-8").trim();
    
    // For blockchain registration, extract base64 content using the new utility
    const { extractPGPKeyMaterial } = await import('../src/utils/keyUtils.js');
    const publicKeyMaterial = await extractPGPKeyMaterial(pgpPublicKey);
    
    return {
      keyType: KeyType.PGPv4,
      publicKeyMaterial,
      fullPublicKey: pgpPublicKey, // Store full armored key for GitVerificationService
      keyId: config.keys.pgp.keyId,
      passphrase: config.keys.pgp.passphrase,
    };
  } else {
    // Use SSH keys
    const sshPublicKeyPath = config.keys.ssh.publicKeyPath.startsWith('/') || config.keys.ssh.publicKeyPath.startsWith('~') ? 
      expandPath(config.keys.ssh.publicKeyPath) : 
      resolve(__dirname, "..", config.keys.ssh.publicKeyPath);
    const sshPrivateKeyPath = config.keys.ssh.privateKeyPath.startsWith('/') || config.keys.ssh.privateKeyPath.startsWith('~') ? 
      expandPath(config.keys.ssh.privateKeyPath) : 
      resolve(__dirname, "..", config.keys.ssh.privateKeyPath);
    
    const sshPublicKey = readFileSync(sshPublicKeyPath, "utf-8").trim();
    
    // Extract SSH key material
    const publicKeyMaterial = extractSSHKeyMaterial(sshPublicKey);
    
    // Determine SSH key type
    const sshKeyType = config.keys.ssh.keyType === "ed25519" ? KeyType.SSHEd25519 : KeyType.SSHSecp256k1;
    
    return {
      keyType: sshKeyType,
      publicKeyMaterial,
      fullPublicKey: sshPublicKey,
      keyType_str: config.keys.ssh.keyType,
      privateKeyPath: sshPrivateKeyPath,
    };
  }
}

async function registerBobKey(bobClient: any, keyData: any, bobAddress: `0x${string}`, config: IntegrationConfig) {
  // Generate nonce and signing message
  const nonce = `integration_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const crypto = require('crypto');
  const nonceHashBuffer = crypto.createHash('sha256').update(nonce).digest();
  const nonceHash = nonceHashBuffer.toString('hex');
  
  let signature: string;
  const message = generateSigningMessage(bobAddress, `0x${nonceHash}`);
  
  if (keyData.keyType === KeyType.PGPv4) {
    // Generate real PGP signature
    try {
      const pgpPrivateKeyPath = config.keys.pgp.privateKeyPath.startsWith('/') || config.keys.pgp.privateKeyPath.startsWith('~') ? 
        expandPath(config.keys.pgp.privateKeyPath) : 
        resolve(__dirname, "..", config.keys.pgp.privateKeyPath);
      
      if (!existsSync(pgpPrivateKeyPath)) {
        throw new Error(`PGP private key not found: ${pgpPrivateKeyPath}`);
      }
      
      const pgpPrivateKey = readFileSync(pgpPrivateKeyPath, "utf-8");
      const passphrase = config.keys.pgp.passphrase || undefined;
      
      signature = await generatePGPSignature(pgpPrivateKey, message, passphrase);
      console.log(chalk.green("✅ Generated real PGP signature"));
    } catch (error) {
      console.error(chalk.red("❌ Failed to generate PGP signature:"), error);
      throw new Error(`Failed to generate real PGP signature: ${error}`);
    }
  } else {
    // Generate real SSH signature
    try {
      if (!keyData.privateKeyPath || !existsSync(keyData.privateKeyPath)) {
        throw new Error(`SSH private key not found: ${keyData.privateKeyPath}`);
      }
      
      signature = await generateSSHSignature(keyData.privateKeyPath, message);
      console.log(chalk.green("✅ Generated real SSH signature"));
      // Remove the '0x' prefix if present
      signature = signature.replace(/^0x/, '');
    } catch (error) {
      console.error(chalk.red("❌ Failed to generate SSH signature:"), error);
      throw new Error(`Failed to generate real SSH signature: ${error}`);
    }
  }

  return await bobClient.gitIdentityRegistry.claimKey({
    keyType: keyData.keyType,
    nonceHash: `0x${nonceHash}`,
    sig: `0x${signature}`,
    publicKey: keyData.publicKeyMaterial
  });
}

async function createAliceEscrow(aliceClient: any, config: IntegrationConfig, oracle: `0x${string}`, testContext: TestContext) {
  const commitTestsData = encodeAbiParameters(
    parseAbiParameters("(string testsCommitHash, uint8 testsCommitAlgo, string[] hosts)"),
    [{
      testsCommitHash: config.repositories.alice.testsCommitHash,
      testsCommitAlgo: config.repositories.alice.testsCommitAlgo,
      hosts: [config.repositories.alice.url]
    }]
  );

  const demand = aliceClient.arbiters.general.trustedOracle.encodeDemand({
    oracle,
    data: commitTestsData,
  });

  return await aliceClient.erc20.escrow.nonTierable.permitAndCreate(
    {
      address: testContext.mockAddresses.erc20A,
      value: BigInt(config.escrow.tokenAmount),
    },
    { arbiter: testContext.addresses.trustedOracleArbiter, demand },
    0n,
  );
}

async function createBobFulfillment(bobClient: any, config: IntegrationConfig, escrowUid: `0x${string}`, keyType: "ssh" | "pgp") {
  const commitConfig = keyType === "ssh" ? config.repositories.bob.ssh : config.repositories.bob.pgp;
  
  return await bobClient.commitObligation.doObligation(
    {
      commitHash: commitConfig.solutionCommitHash,
      commitAlgo: commitConfig.solutionCommitAlgo,
      hosts: [config.repositories.bob.url],
    },
    escrowUid,
  );
}

async function performCompleteArbitration(
  obligation: any, 
  demand: any, 
  config: IntegrationConfig, 
  keyData: any, 
  arbiterClient: any
): Promise<boolean> {
  const senderAddress = obligation[0].sender;
  console.log(chalk.gray(`   👤 Sender: ${senderAddress}`));

  try {
    // Step 1: Verify key registration
    console.log(chalk.yellow("   🔐 Step 1: Verifying key registration..."));
    
    const senderKeyClaim = await arbiterClient.gitIdentityRegistry.getLatestKeyClaim(senderAddress);
    if (!senderKeyClaim || !senderKeyClaim.publicKey) {
      console.log(chalk.red("   ❌ No registered key found"));
      return false;
    }
    console.log(chalk.green("   ✅ Key registration verified"));
    console.log(chalk.gray(`      Registered key type: ${KeyType[senderKeyClaim.keyType]}`));

    // Step 2: Verify commit signature against registered key
    console.log(chalk.yellow("   🔐 Step 2: Verifying commit signature..."));
    
    const solutionCommitHash = obligation[0].commitHash;
    const solutionRepoUrl = obligation[0].hosts[0];
    
    console.log(chalk.gray(`      Verifying commit: ${solutionCommitHash}`));
    console.log(chalk.gray(`      From repository: ${solutionRepoUrl}`));
    
    // Create a map of registered keys for the verifier
    const registeredKeys = new Map();
    registeredKeys.set(senderAddress, senderKeyClaim);
    
    // Use GitVerificationService like the server does (skip GitKeyClaim signature verification for testing)
    const gitVerificationService = new GitVerificationService({
      tempDirectory: './temp/git-verification',
      timeoutMs: config.server.timeout,
      enableSSH: true,
      enableGPG: true,
      enableX509: true,
      cleanupAfterVerification: true,
      autoImportKeys: true,
    });
    
    let verificationResult;
    try {
      console.log('🔐 Verifying commit signature using git verify-commit...');
      verificationResult = await gitVerificationService.verifyCommit(
        solutionRepoUrl,
        solutionCommitHash,
        registeredKeys
      );
      
      if (!verificationResult.isValid) {
        console.log(chalk.red("   ❌ Commit signature verification FAILED"));
        console.log(chalk.red(`      Method: ${verificationResult.verificationDetails.method}`));
        console.log(chalk.red(`      Reason: ${verificationResult.error || 'Invalid signature'}`));
        console.log(chalk.red("   🚨 SECURITY VIOLATION: Solution commit not signed by registered key"));
        return false;
      }
      
      console.log(chalk.green("   ✅ Commit signature verification PASSED"));
      console.log(chalk.gray(`      Verified signature type: ${verificationResult.signatureType}`));
      if (verificationResult.keyFingerprint) {
        console.log(chalk.gray(`      Key fingerprint: ${verificationResult.keyFingerprint}`));
      }
      if (verificationResult.registeredAddress) {
        console.log(chalk.gray(`      Matched registered address: ${verificationResult.registeredAddress}`));
      }
      
    } catch (verificationError) {
      console.log(chalk.red("   ❌ Error during commit verification"));
      console.log(chalk.red(`      Error: ${verificationError instanceof Error ? verificationError.message : String(verificationError)}`));
      console.log(chalk.red("   🚨 SECURITY VIOLATION: Could not verify commit signature"));
      return false;
    }

    // Step 3: Execute real tests (only if signature verification passed)
    console.log(chalk.yellow("   🧪 Step 3: Executing real tests..."));
    
    const testResult = await executeRealTests(obligation, demand, config);
    
    if (testResult.success) {
      console.log(chalk.green("   ✅ Tests PASSED - Solution is correct"));
      return true;
    } else {
      console.log(chalk.red("   ❌ Tests FAILED - Solution has issues"));
      console.log(chalk.red(`      Error: ${testResult.error}`));
      return false;
    }

  } catch (error) {
    console.log(chalk.red(`   ❌ Arbitration error: ${error}`));
    return false;
  }
}

async function executeRealTests(obligation: any, demand: any, config: IntegrationConfig) {
  try {
    const testConfig = GitTestExecution.initConfig();

    // Configure with real repositories and commits
    testConfig.repositories.testcase.url = demand[0].hosts[0];
    testConfig.repositories.testcase.commitHash = demand[0].testsCommitHash;
    
    testConfig.repositories.source.url = obligation[0].hosts[0];
    testConfig.repositories.source.commitHash = obligation[0].commitHash;

    testConfig.execution.timeout = config.server.timeout;
    testConfig.execution.cleanupAfterExecution = config.test.cleanupAfterTest;
    // Note: Unlike the original integration test, the server does NOT disable signature verification
    // The server does verification separately before test execution, but allows test execution to also verify if needed

    console.log(chalk.gray(`      📁 Test repo: ${testConfig.repositories.testcase.url}`));
    console.log(chalk.gray(`      📁 Test commit: ${testConfig.repositories.testcase.commitHash}`));
    console.log(chalk.gray(`      📁 Solution repo: ${testConfig.repositories.source.url}`));
    console.log(chalk.gray(`      📁 Solution commit: ${testConfig.repositories.source.commitHash}`));

    const result = await GitTestExecution.executeTests(testConfig, {
      onProgress: (step) => {
        if (config.test.enableDetailedLogs) {
          console.log(chalk.gray(`      → ${step}`));
        }
      }
    });

    return {
      success: result.testResult.success,
      error: result.testResult.error,
      details: result
    };

  } catch (error) {
    return {
      success: false,
      error: `Test execution failed: ${error}`,
      details: null
    };
  }
}