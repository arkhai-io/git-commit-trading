/**
 * Unit Tests: Fulfillment Submission
 *
 * Tests the CommitObligation fulfillment: seller submits their solution.
 */

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import type { TestContext } from "alkahest-ts/test-utils";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { CommitAlgo } from "../../src/clients/commitObligation";
import { type ExtendedClient, setupTest } from "../utils/setup";

describe("Fulfillment", () => {
	let testContext: TestContext;
	let alice: `0x${string}`;
	let bob: `0x${string}`;
	let oracle: `0x${string}`;
	let aliceClient: ExtendedClient;
	let bobClient: ExtendedClient;

	beforeAll(async () => {
		const setup = await setupTest();
		testContext = setup.testContext;
		aliceClient = setup.aliceClient;
		bobClient = setup.bobClient;

		alice = testContext.alice.address;
		bob = testContext.bob.address;
		oracle = testContext.charlie.address;
	});

	beforeEach(async () => {
		if (testContext?.anvilInitState) {
			await testContext.testClient.loadState({
				state: testContext.anvilInitState,
			});
		}
	});

	afterAll(async () => {
		// Anvil cleaned up on process exit
	});

	const encodeCommitTestsDemand = (demand: {
		testsCommitHash: string;
		testsCommitAlgo: number;
		hosts: string[];
	}): `0x${string}` => {
		return encodeAbiParameters(
			parseAbiParameters(
				"(string testsCommitHash, uint8 testsCommitAlgo, string[] hosts)",
			),
			[demand],
		);
	};

	// Helper to create an escrow for fulfillment tests
	const createEscrow = async () => {
		const arbiter = testContext.addresses.trustedOracleArbiter;

		const commitTestsData = encodeCommitTestsDemand({
			testsCommitHash: `test-${Date.now()}`,
			testsCommitAlgo: CommitAlgo.SHA256,
			hosts: ["github.com/test/repo"],
		});

		const demand = aliceClient.arbiters.general.trustedOracle.encodeDemand({
			oracle,
			data: commitTestsData,
		});

		const { attested: escrow } =
			await aliceClient.erc20.escrow.default.permitAndCreate(
				{
					address: testContext.mockAddresses.erc20A,
					value: 100n,
				},
				{ arbiter, demand },
				0n,
			);

		return { escrow, demand };
	};

	describe("submit", () => {
		test("submits fulfillment with SHA256 commit hash", async () => {
			const { escrow } = await createEscrow();

			const { attested: fulfillment } =
				await bobClient.commitObligation.doObligation(
					{
						commitHash: "abc123def456",
						commitAlgo: CommitAlgo.SHA256,
						hosts: ["github.com/bob/solution"],
					},
					escrow.uid,
				);

			expect(fulfillment.uid).toBeTruthy();
			expect(fulfillment.uid).toMatch(/^0x[a-fA-F0-9]{64}$/);
		}, 60000);

		test("submits fulfillment with MD5 commit hash", async () => {
			const { escrow } = await createEscrow();

			const { attested: fulfillment } =
				await bobClient.commitObligation.doObligation(
					{
						commitHash: "d41d8cd98f00b204e9800998ecf8427e",
						commitAlgo: CommitAlgo.MD5,
						hosts: ["github.com/bob/solution-md5"],
					},
					escrow.uid,
				);

			expect(fulfillment.uid).toBeTruthy();
		}, 60000);

		test("submits fulfillment with multiple hosts", async () => {
			const { escrow } = await createEscrow();

			const { attested: fulfillment } =
				await bobClient.commitObligation.doObligation(
					{
						commitHash: "multi-host-commit",
						commitAlgo: CommitAlgo.SHA256,
						hosts: [
							"github.com/bob/solution",
							"gitlab.com/bob/solution",
							"bitbucket.org/bob/solution",
						],
					},
					escrow.uid,
				);

			expect(fulfillment.uid).toBeTruthy();
		}, 60000);

		test("retrieves obligation data after submission", async () => {
			const { escrow } = await createEscrow();
			const commitHash = "retrievable-commit-hash";

			const { attested: fulfillment } =
				await bobClient.commitObligation.doObligation(
					{
						commitHash,
						commitAlgo: CommitAlgo.SHA256,
						hosts: ["github.com/bob/solution"],
					},
					escrow.uid,
				);

			// Retrieve the obligation data
			const obligationData = await bobClient.commitObligation.getObligationData(
				fulfillment.uid,
			);

			expect(obligationData.commitHash).toBe(commitHash);
			expect(obligationData.commitAlgo).toBe(CommitAlgo.SHA256);
			expect(obligationData.hosts).toContain("github.com/bob/solution");
		}, 60000);
	});

	describe("encode/decode", () => {
		test("encodes and decodes obligation data", () => {
			const data = {
				commitHash: "test-hash-123",
				commitAlgo: CommitAlgo.SHA256,
				hosts: ["host1.com", "host2.com"],
			};

			const encoded = bobClient.commitObligation.encode(data);
			expect(encoded).toMatch(/^0x/);

			const decoded = bobClient.commitObligation.decode(encoded);
			expect(decoded.commitHash).toBe(data.commitHash);
			expect(decoded.commitAlgo).toBe(data.commitAlgo);
			expect(decoded.hosts).toEqual(data.hosts);
		});
	});
});
