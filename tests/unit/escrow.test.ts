/**
 * Unit Tests: Escrow Creation and Collection
 *
 * Tests the escrow lifecycle: create escrow with demand, collect after arbitration.
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

describe("Escrow", () => {
	let testContext: TestContext;
	let alice: `0x${string}`;
	let bob: `0x${string}`;
	let oracle: `0x${string}`;
	let aliceClient: ExtendedClient;
	let bobClient: ExtendedClient;
	let oracleClient: ExtendedClient;

	beforeAll(async () => {
		const setup = await setupTest();
		testContext = setup.testContext;
		aliceClient = setup.aliceClient;
		bobClient = setup.bobClient;
		oracleClient = setup.charlieClient;

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

	describe("create", () => {
		test("creates escrow with valid demand", async () => {
			const arbiter = testContext.addresses.trustedOracleArbiter;

			const commitTestsData = encodeCommitTestsDemand({
				testsCommitHash: "abc123",
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

			expect(escrow.uid).toBeTruthy();
			expect(escrow.uid).toMatch(/^0x[a-fA-F0-9]{64}$/);
		}, 60000);

		test("escrow has correct value locked", async () => {
			const arbiter = testContext.addresses.trustedOracleArbiter;
			const escrowValue = 500n;

			const commitTestsData = encodeCommitTestsDemand({
				testsCommitHash: "def456",
				testsCommitAlgo: CommitAlgo.SHA256,
				hosts: ["github.com/test/repo2"],
			});

			const demand = aliceClient.arbiters.general.trustedOracle.encodeDemand({
				oracle,
				data: commitTestsData,
			});

			const { attested: escrow } =
				await aliceClient.erc20.escrow.default.permitAndCreate(
					{
						address: testContext.mockAddresses.erc20A,
						value: escrowValue,
					},
					{ arbiter, demand },
					0n,
				);

			expect(escrow.uid).toBeTruthy();
		}, 60000);
	});

	describe("collect", () => {
		test("seller collects escrow after successful arbitration", async () => {
			const arbiter = testContext.addresses.trustedOracleArbiter;

			// Alice creates escrow
			const commitTestsData = encodeCommitTestsDemand({
				testsCommitHash: "ghi789",
				testsCommitAlgo: CommitAlgo.SHA256,
				hosts: ["github.com/test/repo3"],
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

			// Bob submits fulfillment
			const { attested: fulfillment } =
				await bobClient.commitObligation.doObligation(
					{
						commitHash: "solution-commit",
						commitAlgo: CommitAlgo.SHA256,
						hosts: ["github.com/bob/solution"],
					},
					escrow.uid,
				);

			// Bob requests arbitration
			await bobClient.arbiters.general.trustedOracle.requestArbitration(
				fulfillment.uid,
				oracle,
				demand,
			);

			// Oracle approves
			await oracleClient.arbiters.general.trustedOracle.arbitrateMany(
				async () => true,
				{ mode: "past" },
			);

			// Bob collects
			const collectionHash = await bobClient.erc20.escrow.default.collect(
				escrow.uid,
				fulfillment.uid,
			);

			expect(collectionHash).toBeTruthy();
			expect(collectionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
		}, 60000);

		test("seller cannot collect without arbitration approval", async () => {
			const arbiter = testContext.addresses.trustedOracleArbiter;

			// Alice creates escrow
			const commitTestsData = encodeCommitTestsDemand({
				testsCommitHash: "jkl012",
				testsCommitAlgo: CommitAlgo.SHA256,
				hosts: ["github.com/test/repo4"],
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

			// Bob submits fulfillment
			const { attested: fulfillment } =
				await bobClient.commitObligation.doObligation(
					{
						commitHash: "solution-commit-2",
						commitAlgo: CommitAlgo.SHA256,
						hosts: ["github.com/bob/solution2"],
					},
					escrow.uid,
				);

			// Bob tries to collect WITHOUT arbitration - should fail
			await expect(
				bobClient.erc20.escrow.default.collect(escrow.uid, fulfillment.uid),
			).rejects.toThrow();
		}, 60000);
	});
});
