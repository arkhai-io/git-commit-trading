#!/usr/bin/env node

import chalk from "chalk";
import { Command } from "commander";
import { checkKeyCommand } from "./commands/check-key.js";
import { collectCommand } from "./commands/collect.js";
import { fulfillCommand } from "./commands/fulfill.js";
import { listCommand } from "./commands/list.js";
import { newClientCommand } from "./commands/new-client.js";
import { registerKeyCommand } from "./commands/register-key.js";
import { serverCommand } from "./commands/server.js";
import { submitCommand } from "./commands/submit.js";

const program = new Command();

program
	.name("git-escrows")
	.description("Git-based escrow system for code challenges and bounties")
	.version("1.0.0");

// New Client command - Initialize a client with .env configuration
program
	.command("new-client")
	.description("Create a .env file with private key and network configuration")
	.requiredOption("--privateKey <key>", "Private key for the client (0x...)")
	.requiredOption(
		"--network <network>",
		"Network to connect to (anvil, base-sepolia)",
	)
	.action(newClientCommand);

// Register Key command - Register Git cryptographic key to blockchain address
program
	.command("register-key")
	.description(
		"Register your Git cryptographic key (SSH, PGP, or X509) to your Ethereum address for commit verification",
	)
	.option(
		"--path <path>",
		"Path to key file (SSH public key, PGP public key, or X509 certificate)",
	)
	.option(
		"--private-key-file <path>",
		"Path to SSH private key file for signing (SSH keys only)",
	)
	.option(
		"--public-key-file <path>",
		"Path to SSH public key file (alternative to --path for SSH keys)",
	)
	.option(
		"--pgp-key-file <path>",
		"Path to PGP public key file (armored format)",
	)
	.option(
		"--pgp-private-key-file <path>",
		"Path to PGP private key file for signing (armored format)",
	)
	.option(
		"--pgp-passphrase <passphrase>",
		"Passphrase for encrypted PGP private key",
	)
	.option(
		"--x509-cert-file <path>",
		"Path to X509 certificate file (PEM format)",
	)
	.option(
		"--key-type <type>",
		"Key type (auto-detected from key content)",
		"auto",
	)
	.option(
		"--skip-server-import",
		"Skip importing key to server for local verification",
		false,
	)
	.action(registerKeyCommand);

// Check Key command - Check if Git SSH key is registered
program
	.command("check-key")
	.description(
		"Check if your Git SSH key is registered to your Ethereum address",
	)
	.option(
		"--address <address>",
		"Ethereum address to check (default: from .env)",
	)
	.option("--verbose", "Show detailed key information", false)
	.action(checkKeyCommand);

// List command - Show all available escrows
program
	.command("list")
	.description("List all available escrows from the blockchain")
	.option("--status <status>", "Filter by status (open, fulfilled, expired)")
	.option("--address <address>", "Filter by buyer or recipient address")
	.option("--oracle <address>", "Filter by oracle address")
	.option(
		"--from-block <number>",
		"Starting block number to scan from (defaults to 30 days ago)",
	)
	.option("--limit <number>", "Maximum number of escrows to show", "20")
	.option("--format <format>", "Output format (table, json, csv)", "table")
	.option("--verbose", "Show detailed information", false)
	.action(listCommand);

// Submit command - Alice creates a new demand
program
	.command("submit")
	.description("Create a new escrow demand for a coding challenge")
	.requiredOption(
		"--tests-repo <url>",
		"Git repository URL containing test cases",
	)
	.requiredOption("--tests-commit <hash>", "Commit hash of the test cases")
	.requiredOption("--reward <amount>", "Reward amount in tokens")
	.option("--tests-algo <algo>", "Commit hash algorithm", "sha1")
	.option("--arbiter <address>", "Arbiter contract address")
	.option("--oracle <address>", "Oracle address for arbitration")
	.option("--token <address>", "ERC20 token contract address")

	.action(submitCommand);

// Fulfill command - Bob submits a solution
program
	.command("fulfill")
	.description("Submit a solution to fulfill an escrow demand")
	.requiredOption("--escrow-uid <uid>", "Escrow UID to fulfill")
	.requiredOption(
		"--solution-repo <url>",
		"Git repository URL containing the solution",
	)
	.requiredOption("--solution-commit <hash>", "Commit hash of the solution")
	.option("--solution-algo <algo>", "Commit hash algorithm", "sha1")
	.option(
		"--additional-hosts <hosts>",
		"Additional host URLs (comma-separated)",
	)
	.option(
		"--verify-key",
		"Verify that your registered Git key matches the commit (default: true)",
		true,
	)
	.option("--no-verify-key", "Skip Git key verification (not recommended)")
	.action(fulfillCommand);

// Collect command - Bob collects the reward
program
	.command("collect")
	.description("Collect the reward from a fulfilled escrow")
	.requiredOption("--escrow-uid <uid>", "Escrow UID to collect from")
	.requiredOption(
		"--fulfillment-uid <uid>",
		"Fulfillment UID that was approved",
	)
	.action(collectCommand);

// Server command - Charlie runs the arbiter server
program
	.command("server")
	.description("Run the arbiter server to listen and arbitrate escrows")
	.option(
		"--mode <mode>",
		"Arbitration mode: past, pastUnarbitrated, allUnarbitrated (default), all, future",
		"allUnarbitrated",
	)
	.option(
		"--transport <type>",
		"Transport type: http or websocket (default: http)",
		"http",
	)
	.option("--port <port>", "Server port (deprecated)", "3000")
	.option(
		"--polling-interval <ms>",
		"Polling interval for new escrows (ms)",
		"1000",
	)
	.option("--timeout <ms>", "Test execution timeout (ms)", "300000")
	.option("--cleanup", "Cleanup temporary directories after execution", true)
	.option("--verify-key", "Verify Git key registration (default: true)", true)
	.option("--no-verify-key", "Skip Git key verification (not recommended)")
	.action(serverCommand);

// Global error handling
program.on("command:*", () => {
	console.error(chalk.red(`Invalid command: ${program.args.join(" ")}`));
	console.log("See --help for a list of available commands.");
	process.exit(1);
});

// Parse command line arguments
program.parse();
