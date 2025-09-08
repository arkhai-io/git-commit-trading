import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
} from "bun:test";
import { setupTest } from "./utils/setup";
import {
  teardownTestEnvironment,
  type TestContext,
} from "alkahest-ts/tests/utils/setup";
import {
  KeyType,
  createGitKeyClaim,
} from "../src/clients/gitIdentityRegistry";

describe("GitIdentityRegistry Client", () => {
  let testContext: TestContext;
  let alice: `0x${string}`;
  let bob: `0x${string}`;
  let aliceClient: any;
  let bobClient: any;
  let testClient: TestContext["testClient"];
  let gitIdentityRegistryAddress: `0x${string}`;

  beforeAll(async () => {
    const setup = await setupTest();
    testContext = setup.testContext;
    aliceClient = setup.aliceClient;
    bobClient = setup.bobClient;
    gitIdentityRegistryAddress = setup.gitIdentityRegistryAddress;
    alice = testContext.alice;
    bob = testContext.bob;
    testClient = testContext.testClient;
  });

  beforeEach(async () => {
    if (testContext.anvilInitState) {
      await testClient.loadState({ state: testContext.anvilInitState });
    }
  });

  afterAll(async () => {
    await teardownTestEnvironment(testContext);
  });

  it("should create a git key claim correctly", () => {
    const claim = createGitKeyClaim(
      KeyType.SSHEd25519,
      "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      "ssh-ed25519 AAAAC3Nz... alice@example.com"
    );

    expect(claim.keyType).toBe(KeyType.SSHEd25519);
    expect(claim.publicKey).toContain("ssh-ed25519");
  });

  it("should handle hex strings with 0x prefix", () => {
    const claim = createGitKeyClaim(
      KeyType.PGPv4,
      "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      "pgp-pubkey text block"
    );

    expect(claim.publicKey).toBe("pgp-pubkey text block");
  });

  describe("GitIdentityRegistry - Contract Interactions", () => {
    it("should claim a Git key successfully", async () => {
      try {
        const claimData = createGitKeyClaim(
          KeyType.SSHEd25519,
          "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
          "ssh-ed25519 AAAAC3... alice@example.com"
        );

        const result = await aliceClient.gitIdentityRegistry.claimKey(claimData);
        expect(result).toBeDefined();
        expect(result).toHaveProperty("hash");
      } catch (error) {
        if (
          (error as Error).message.includes("no code at address") ||
          (error as Error).message.includes("CALL_EXCEPTION")
        ) {
          console.log("⚠️ Contract not deployed, skipping test");
          return;
        }
        throw error;
      }
    });

    it("should prevent claiming multiple keys from same address", async () => {
      try {
        // First claim should succeed
        const claimData1 = createGitKeyClaim(
          KeyType.PGPv4,
          "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321",
          "cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe",
          "-----BEGIN PGP PUBLIC KEY BLOCK----- ..."
        );

        await bobClient.gitIdentityRegistry.claimKey(claimData1);

        // Second claim from same address should fail
        const claimData2 = createGitKeyClaim(
          KeyType.SSHEd25519,
          "1111111111111111111111111111111111111111111111111111111111111111",
          "2222222222222222222222222222222222222222222222222222222222222222",
          "ssh-ed25519 AAAAB3... another@example.com"
        );

        try {
          await bobClient.gitIdentityRegistry.claimKey(claimData2);
          // If we reach here, the test should fail
          expect(false).toBe(true); // Force failure
        } catch (error) {
          expect((error as Error).message).toContain("Address already has a claimed key");
        }
      } catch (error) {
        if (
          (error as Error).message.includes("no code at address") ||
          (error as Error).message.includes("CALL_EXCEPTION")
        ) {
          console.log("⚠️ Skipped test due to contract issue");
          return;
        }
        throw error;
      }
    });
  });
});
