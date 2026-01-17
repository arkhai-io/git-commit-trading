import CommitObligation from "@contracts/CommitObligation.json";
import {
	setupTestEnvironment,
	type TestContext,
} from "alkahest-ts/sdks/ts/tests/utils/setup";
import type { AlkahestClient } from "alkahest-ts/sdks/ts/src/index";
import {
	type CommitObligationAddresses,
	makeCommitObligationClient,
} from "../../src/clients/commitObligation";
import {
	type GitIdentityRegistryAddresses,
	makeGitIdentityRegistryClient,
} from "../../src/clients/gitIdentityRegistry";
import GitIdentityRegistry from "../../src/contracts/GitIdentityRegistry.json";

// ExtendedClient type is now inferred from the setupTest return type
export type ExtendedClient = Awaited<ReturnType<typeof setupTest>>["aliceClient"];

export async function setupTest() {
	const testContext: TestContext = await setupTestEnvironment();

	const commitObligationAddress =
		await testContext.deployObligation(CommitObligation);

	// Deploy GitIdentityRegistry using deployContract (not deployObligation since it doesn't need EAS)
	const gitIdentityRegistryAddress =
		await testContext.deployContract(GitIdentityRegistry);

	// Re-capture state snapshot after deploying additional contracts
	// This ensures loadState() restores to a state with all contracts deployed
	testContext.anvilInitState = await testContext.testClient.dumpState();

	const commitObligationAddresses: CommitObligationAddresses = {
		commitObligation: commitObligationAddress,
	};

	const gitIdentityRegistryAddresses: GitIdentityRegistryAddresses = {
		gitIdentityRegistry: gitIdentityRegistryAddress,
	};

	// Helper to create extended client - types now infer correctly via alkahest's extend()
	const createExtendedClient = (baseClient: AlkahestClient) => {
		return baseClient.extend((client) => ({
			commitObligation: makeCommitObligationClient(
				client.viemClient,
				commitObligationAddresses,
			),
			gitIdentityRegistry: makeGitIdentityRegistryClient(
				client.viemClient,
				gitIdentityRegistryAddresses,
			),
		}));
	};

	// New SDK structure: testContext.alice.client instead of testContext.aliceClient
	const aliceClient = createExtendedClient(testContext.alice.client);
	const bobClient = createExtendedClient(testContext.bob.client);
	const charlieClient = createExtendedClient(testContext.charlie.client);

	return {
		testContext,
		commitObligationAddress,
		gitIdentityRegistryAddress,
		aliceClient,
		bobClient,
		charlieClient,
		// Also export addresses for convenience
		alice: testContext.alice,
		bob: testContext.bob,
		charlie: testContext.charlie,
	};
}
