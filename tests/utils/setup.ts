
import { setupTestEnvironment, type TestContext } from "alkahest-ts/tests/utils/setup";
import CommitObligation from "@contracts/CommitObligation.json";
import { makeCommitObligationClient, type CommitObligationAddresses } from "../../src/clients/commitObligation";

export async function setupTest() {
  let testContext: TestContext = await setupTestEnvironment();

  const commitObligationAddress = await testContext.deployObligation(CommitObligation);

  const commitObligationAddresses: CommitObligationAddresses = {
    commitObligation: commitObligationAddress,
  };

  const aliceClient = testContext.aliceClient.extend((client: any) => ({
    commitObligation: makeCommitObligationClient(client.viemClient, commitObligationAddresses),
  }));
  const bobClient = testContext.bobClient.extend((client: any) => ({
    commitObligation: makeCommitObligationClient(client.viemClient, commitObligationAddresses),
  }));


  return {
    testContext,
    commitObligationAddress,
    aliceClient,
    bobClient,
  };
}

