import CommitObligation from "@contracts/CommitObligation.json";
import {
	setupTestEnvironment,
	type TestContext,
} from "alkahest-ts/sdks/ts/tests/utils/setup";
import {
	type CommitObligationAddresses,
	makeCommitObligationClient,
} from "../../src/clients/commitObligation";
import {
	type GitIdentityRegistryAddresses,
	makeGitIdentityRegistryClient,
} from "../../src/clients/gitIdentityRegistry";
import GitIdentityRegistry from "../../src/contracts/GitIdentityRegistry.json";

export async function setupTest() {
	const testContext: TestContext = await setupTestEnvironment();

	const commitObligationAddress =
		await testContext.deployObligation(CommitObligation);

	// Deploy GitIdentityRegistry using deployContract (not deployObligation since it doesn't need EAS)
	const gitIdentityRegistryAddress =
		await testContext.deployContract(GitIdentityRegistry);

	const commitObligationAddresses: CommitObligationAddresses = {
		commitObligation: commitObligationAddress,
	};

	const gitIdentityRegistryAddresses: GitIdentityRegistryAddresses = {
		gitIdentityRegistry: gitIdentityRegistryAddress,
	};

	// New SDK structure: testContext.alice.client instead of testContext.aliceClient
	const aliceClient = testContext.alice.client.extend((client: any) => ({
		commitObligation: makeCommitObligationClient(
			client.viemClient,
			commitObligationAddresses,
		),
		gitIdentityRegistry: makeGitIdentityRegistryClient(
			client.viemClient,
			gitIdentityRegistryAddresses,
		),
	}));

	const bobClient = testContext.bob.client.extend((client: any) => ({
		commitObligation: makeCommitObligationClient(
			client.viemClient,
			commitObligationAddresses,
		),
		gitIdentityRegistry: makeGitIdentityRegistryClient(
			client.viemClient,
			gitIdentityRegistryAddresses,
		),
	}));

	const charlieClient = testContext.charlie.client.extend((client: any) => ({
		commitObligation: makeCommitObligationClient(
			client.viemClient,
			commitObligationAddresses,
		),
		gitIdentityRegistry: makeGitIdentityRegistryClient(
			client.viemClient,
			gitIdentityRegistryAddresses,
		),
	}));

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
