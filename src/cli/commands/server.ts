import chalk from "chalk";
import { parseAbiParameters } from "viem";
import { getRegisteredKey } from "../../crypto/index.js";
import { verifyAndRunTests } from "../../test-execution/index.js";
import { createClientFromEnv, requireEnvFile } from "../utils/envLoader.js";

interface ServerOptions {
	port?: string;
	pollingInterval?: string;
	timeout?: string;
	cleanup?: boolean;
	mode?: "past" | "pastUnarbitrated" | "allUnarbitrated" | "all" | "future";
	verifyKey?: boolean;
	transport?: "http" | "websocket";
}

export async function serverCommand(options: ServerOptions) {
	try {
		console.log(chalk.blue("Starting Git Escrows Arbiter Server..."));

		// Validate mode options
		const mode = options.mode || "allUnarbitrated";
		if (
			![
				"past",
				"pastUnarbitrated",
				"allUnarbitrated",
				"all",
				"future",
			].includes(mode)
		) {
			throw new Error(
				"Mode must be one of: past, pastUnarbitrated, allUnarbitrated, all, future",
			);
		}

		const pollingInterval = parseInt(options.pollingInterval || "1000", 10);
		const timeout = parseInt(options.timeout || "300000", 10);
		const cleanup = options.cleanup !== false;
		const transport = options.transport || "http";

		const modeLabels = {
			past: "Arbitrate All Past Only",
			pastUnarbitrated: "Arbitrate Unarbitrated Past Only",
			allUnarbitrated: "Arbitrate Unarbitrated Past + Listen for New",
			all: "Arbitrate All Past + Listen for New",
			future: "Listen for New Only",
		};

		console.log(chalk.gray("Server configuration:"));
		console.log(chalk.gray(`  Mode: ${modeLabels[mode]}`));
		console.log(chalk.gray(`  Transport: ${transport.toUpperCase()}`));
		console.log(chalk.gray(`  Polling Interval: ${pollingInterval}ms`));
		console.log(chalk.gray(`  Test Timeout: ${timeout}ms`));
		console.log(chalk.gray(`  Cleanup: ${cleanup}`));
		console.log(chalk.gray(`  Docker Execution: Enabled (framework-based)`));

		// Check for .env file and load client
		requireEnvFile();

		console.log(chalk.gray("Setting up blockchain client..."));
		const {
			client,
			config,
			address,
			hasCommitObligation,
			hasGitIdentityRegistry,
		} = await createClientFromEnv(".env", transport);

		if (!hasCommitObligation) {
			throw new Error(
				"COMMIT_OBLIGATION_ADDRESS is required in .env file for the server command",
			);
		}

		console.log(chalk.green("Blockchain environment ready"));
		console.log(chalk.gray(`  Oracle Address (Your Wallet): ${address}`));
		console.log(
			chalk.gray(
				`  CommitObligation Contract: ${config.commitObligationAddress}`,
			),
		);
		console.log(
			chalk.gray(
				`  TrustedOracleArbiter Contract: ${client.contractAddresses.trustedOracleArbiter}`,
			),
		);

		if (hasGitIdentityRegistry) {
			console.log(
				chalk.gray(
					`  GitIdentityRegistry Contract: ${config.gitIdentityRegistryAddress}`,
				),
			);
			console.log(chalk.green("✓ Git key verification enabled"));
		} else {
			console.log(
				chalk.yellow(
					"⚠️ GitIdentityRegistry not available - Git key verification disabled",
				),
			);
		}

		// Define the arbitration logic
		// Callback receives AttestationWithDemand { attestation, demand }
		const arbitrate = async ({
			attestation,
		}: {
			attestation: {
				data: `0x${string}`;
				refUID: `0x${string}`;
				recipient: `0x${string}`;
			};
			demand: `0x${string}`;
		}) => {
			console.log(
				chalk.green(
					"=============== Received new fulfillment to be arbitrated ===============",
				),
			);
			console.log("Arbitrating attestation:", attestation);

			// Decode the obligation data from the attestation
			const obligationData = client.extractObligationData(
				parseAbiParameters(
					"(string commitHash,uint8 commitAlgo,string[] hosts)",
				),
				attestation,
			);

			// Get the escrow attestation and decode demand data
			const escrowAttestation = await client.getEscrowAttestation(attestation);
			const demandData = client.extractDemandData(
				parseAbiParameters(
					"(string testsCommitHash, uint8 testsCommitAlgo, string[] hosts)",
				),
				escrowAttestation,
			);

			// Extract data
			const obligation = obligationData[0];
			const demand = demandData[0];
			const senderAddress =
				attestation.recipient.toLowerCase() as `0x${string}`;

			console.log(`🔍 Fulfillment submitted by: ${senderAddress}`);
			console.log("📁 Repository configuration:");
			console.log(`   Test repo hosts: ${demand.hosts.join(", ")}`);
			console.log(`   Test commit: ${demand.testsCommitHash}`);
			console.log(`   Solution repo hosts: ${obligation.hosts.join(", ")}`);
			console.log(`   Solution commit: ${obligation.commitHash}`);

			// Run verification and tests
			console.log("\n🧪 Running verification and test execution...");

			const shouldVerify = options.verifyKey && hasGitIdentityRegistry;

			// Look up registered keys if verification is enabled
			let sourceKey = null;
			if (shouldVerify && config.gitIdentityRegistryAddress) {
				console.log(
					chalk.cyan(`Looking up registered key for ${senderAddress}...`),
				);
				sourceKey = await getRegisteredKey(
					client.viemClient,
					config.gitIdentityRegistryAddress as `0x${string}`,
					senderAddress,
				);
				if (sourceKey) {
					console.log(chalk.green(`✅ Found registered key for sender`));
				} else {
					console.log(
						chalk.yellow(`⚠️ No valid registered key found for sender`),
					);
				}
			}

			const result = await verifyAndRunTests({
				tests: {
					hosts: [...demand.hosts],
					commit: demand.testsCommitHash,
				},
				source: {
					hosts: [...obligation.hosts],
					commit: obligation.commitHash,
					verifyWith: sourceKey ?? undefined,
				},
				timeout,
				cleanup,
			});

			console.log(`\n🎯 Result: ${result.success ? "PASSED ✅" : "FAILED ❌"}`);
			console.log(`   Framework used: ${result.frameworkUsed}`);
			console.log(`   Duration: ${result.duration}ms`);

			if (!result.success) {
				console.log("\n❌ Failure Details:");
				if (result.error) {
					console.log("   Error:", result.error);
				}
				if (result.output?.trim()) {
					console.log("\n   Output:");
					console.log(`   ${"─".repeat(70)}`);
					const outputLines = result.output.split("\n");
					const linesToShow = outputLines.slice(-100);
					if (outputLines.length > 100) {
						console.log(
							`   ... (showing last 100 of ${outputLines.length} lines)`,
						);
					}
					for (const line of linesToShow) {
						console.log(`   ${line}`);
					}
					console.log(`   ${"─".repeat(70)}`);
				}
			}

			return result.success;
		};

		// Determine if this mode listens for new events
		const isListeningMode =
			mode === "all" || mode === "allUnarbitrated" || mode === "future";

		if (isListeningMode) {
			console.log(
				chalk.yellow(
					mode === "future"
						? "Listening for new obligations..."
						: "Arbitrating past obligations and listening for new...",
				),
			);
			console.log(chalk.gray("Press Ctrl+C to stop the server\n"));
		} else {
			console.log(chalk.yellow("Arbitrating past obligations..."));
		}

		let unwatchFn: (() => void) | null = null;

		if (isListeningMode) {
			process.on("SIGINT", async () => {
				console.log(chalk.yellow("\nShutting down server..."));
				if (unwatchFn) unwatchFn();
				console.log(chalk.green("✓ Server shutdown complete"));
				process.exit(0);
			});

			process.on("uncaughtException", (error) => {
				console.error(chalk.red("❌ Uncaught exception:"), error);
				if (
					error.message?.includes("WebSocket") ||
					error.message?.includes("connection")
				) {
					console.log(
						chalk.yellow(
							"⚠️ Connection error. Server will attempt to reconnect...",
						),
					);
				} else {
					if (unwatchFn) unwatchFn();
					process.exit(1);
				}
			});

			process.on("unhandledRejection", (reason, _promise) => {
				console.error(chalk.red("❌ Unhandled rejection:"), reason);
			});
		}

		const { unwatch, decisions } =
			await client.arbiters.general.trustedOracle.arbitrateMany(arbitrate, {
				mode,
				onAfterArbitrate: async (decision: {
					decision: boolean;
					hash: string;
					attestation: { uid: string };
				}) => {
					console.log(
						chalk.green(
							`✓ Arbitration completed: ${decision.decision ? "PASSED" : "FAILED"}`,
						),
					);
					console.log(chalk.gray(`  Transaction Hash: ${decision.hash}`));
					console.log(
						chalk.gray(`  Attestation UID: ${decision.attestation.uid}`),
					);
				},
				pollingInterval,
			});

		unwatchFn = unwatch;

		// Log past decisions for non-listening modes
		if (!isListeningMode) {
			for (const decision of decisions) {
				console.log(
					chalk.green(
						`✓ Arbitration completed: ${decision.decision ? "PASSED" : "FAILED"}`,
					),
				);
				console.log(chalk.gray(`  Transaction Hash: ${decision.hash}`));
				console.log(
					chalk.gray(`  Attestation UID: ${decision.attestation.uid}`),
				);
			}

			console.log(
				chalk.green(
					`✓ Arbitration completed for ${decisions.length} past obligations`,
				),
			);
			process.exit(0);
		}

		if (decisions.length > 0) {
			console.log(
				chalk.green(
					`✓ Processed ${decisions.length} past arbitration requests`,
				),
			);
		} else if (mode === "all" || mode === "allUnarbitrated") {
			console.log(
				chalk.gray("No past requests found. Waiting for new requests..."),
			);
		}

		console.log(chalk.green("✓ Server is now listening..."));

		// Keep alive
		await new Promise<void>(() => {});
	} catch (error) {
		console.error(chalk.red("Failed to start server:"));
		console.error(
			chalk.red(error instanceof Error ? error.message : String(error)),
		);
		process.exit(1);
	}
}
