import {
  setupTestEnvironment,
  type TestContext,
} from "alkahest-ts/tests/utils/setup";
import CommitObligation from "@contracts/CommitObligation.json";
import GitIdentityRegistry from "../../src/contracts/GitIdentityRegistry.json";
import {
  makeCommitObligationClient,
  type CommitObligationAddresses,
} from "../../src/clients/commitObligation";
import {
  makeGitIdentityRegistryClient,
  type GitIdentityRegistryAddresses,
} from "../../src/clients/gitIdentityRegistry";

export async function setupTest() {
  let testContext: TestContext = await setupTestEnvironment();

  const commitObligationAddress = await testContext.deployObligation(
    CommitObligation
  );

  // Deploy GitIdentityRegistry using deployContract (not deployObligation since it doesn't need EAS)
  const gitIdentityRegistryAddress = await testContext.deployContract(
    GitIdentityRegistry
  );

  const commitObligationAddresses: CommitObligationAddresses = {
    commitObligation: commitObligationAddress,
  };

  const gitIdentityRegistryAddresses: GitIdentityRegistryAddresses = {
    gitIdentityRegistry: gitIdentityRegistryAddress,
  };

  const aliceClient = testContext.aliceClient.extend((client: any) => ({
    commitObligation: makeCommitObligationClient(
      client.viemClient,
      commitObligationAddresses
    ),
    gitIdentityRegistry: makeGitIdentityRegistryClient(
      client.viemClient,
      gitIdentityRegistryAddresses
    ),
  }));

  const bobClient = testContext.bobClient.extend((client: any) => ({
    commitObligation: makeCommitObligationClient(
      client.viemClient,
      commitObligationAddresses
    ),
    gitIdentityRegistry: makeGitIdentityRegistryClient(
      client.viemClient,
      gitIdentityRegistryAddresses
    ),
  }));

  return {
    testContext,
    commitObligationAddress,
    gitIdentityRegistryAddress,
    aliceClient,
    bobClient,
  };
}
