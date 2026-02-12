import { existsSync, readFileSync } from "node:fs";
import { makeClient } from "alkahest-ts";
import chalk from "chalk";
import {
	type Account,
	type Chain,
	createWalletClient,
	http,
	type Transport,
	type WalletClient,
	webSocket,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, foundry, sepolia } from "viem/chains";
import { makeCommitObligationClient } from "../../clients/commitObligation.js";
import { makeGitIdentityRegistryClient } from "../../clients/gitIdentityRegistry.js";

export interface EnvConfig {
	privateKey: `0x${string}`;
	network?: string;
	rpcUrl?: string;
	wsRpcUrl?: string;
	commitObligationAddress?: string;
	gitIdentityRegistryAddress?: string;
	// DEBUG=true enables verbose logging with trace IDs
}

interface CanonicalAddresses {
	commitObligation: `0x${string}`;
	gitIdentityRegistry: `0x${string}`;
}

const CANONICAL_ADDRESSES: Record<string, CanonicalAddresses> = {
	"base-sepolia": {
		commitObligation: "0x03d2591DfDf75611AdE94A9a80af61F9BcBfc4e2",
		gitIdentityRegistry: "0xc6b3fA56853F7D5abdFdaa7d008d9c27eBdE3e8a",
	},
	sepolia: {
		commitObligation: "0x5bf1EE1fEC1bC25d20C4537f74bD0909B195DEBd",
		gitIdentityRegistry: "0x57D5165F9487F6E7bD6E6a24017FAdadc2b1D7D2",
	},
};

/**
 * Load and parse .env file
 */
function loadEnvFile(envPath: string = ".env"): Record<string, string> {
	if (!existsSync(envPath)) {
		throw new Error(
			`Environment file ${envPath} not found. Please create a .env file with PRIVATE_KEY.`,
		);
	}

	const envContent = readFileSync(envPath, "utf8");
	const envVars: Record<string, string> = {};

	for (const line of envContent.split("\n")) {
		const trimmedLine = line.trim();
		if (trimmedLine && !trimmedLine.startsWith("#")) {
			const [key, ...valueParts] = trimmedLine.split("=");
			if (key && valueParts.length > 0) {
				const value = valueParts.join("=").replace(/^["']|["']$/g, ""); // Remove surrounding quotes
				envVars[key.trim()] = value.trim();
			}
		}
	}

	return envVars;
}

/**
 * Validate required environment variables
 */
function validateEnvConfig(envVars: Record<string, string>): EnvConfig {
	const privateKey = envVars.PRIVATE_KEY;

	if (!privateKey) {
		throw new Error("PRIVATE_KEY is required in .env file");
	}

	// Validate private key format
	if (!privateKey.startsWith("0x") || privateKey.length !== 66) {
		throw new Error(
			"PRIVATE_KEY must be a valid hex string starting with 0x and 64 characters long",
		);
	}

	const network = (envVars.NETWORK || "anvil").toLowerCase();
	const normalizedNetwork =
		network === "basesepolia" ? "base-sepolia" : network;
	const canonical = CANONICAL_ADDRESSES[normalizedNetwork];

	// Env vars override canonical addresses; normalize to lowercase
	const commitObligationAddress =
		envVars.COMMIT_OBLIGATION_ADDRESS?.toLowerCase() ||
		canonical?.commitObligation.toLowerCase();
	const gitIdentityRegistryAddress =
		envVars.GIT_IDENTITY_REGISTRY_ADDRESS?.toLowerCase() ||
		canonical?.gitIdentityRegistry.toLowerCase();

	return {
		privateKey: privateKey as `0x${string}`,
		network: envVars.NETWORK || "anvil",
		rpcUrl: envVars.RPC_URL,
		wsRpcUrl: envVars.WS_RPC_URL,
		commitObligationAddress,
		gitIdentityRegistryAddress,
	};
}

/**
 * Create a blockchain client from environment configuration
 */
export async function createClientFromEnv(
	envPath: string = ".env",
	transportType: "http" | "websocket" = "http",
) {
	console.log(chalk.gray("Loading environment configuration..."));

	const envVars = loadEnvFile(envPath);
	const config = validateEnvConfig(envVars);

	// Create account from private key to derive address
	const account = privateKeyToAccount(config.privateKey);
	const address = account.address;

	console.log(chalk.green("✓ Environment configuration loaded"));
	console.log(chalk.gray(`  Address: ${address}`));

	const network = config.network || "anvil";
	console.log(chalk.gray(`  Network: ${network}`));
	console.log(chalk.gray(`  Transport: ${transportType.toUpperCase()}`));

	if (transportType === "websocket" && config.wsRpcUrl) {
		console.log(
			chalk.gray(`  WebSocket URL: ${config.wsRpcUrl.substring(0, 40)}...`),
		);
	}

	// Helper to create transport based on type
	const createTransport = (httpUrl: string) => {
		if (transportType === "websocket") {
			// Use WS_RPC_URL if available, otherwise convert HTTP URL to WebSocket
			let wsUrl = config.wsRpcUrl;

			if (!wsUrl) {
				// Fallback: convert http/https URLs to ws/wss
				wsUrl = httpUrl.replace(/^http/, "ws");
				console.log(
					chalk.yellow(
						`⚠️ WS_RPC_URL not found in .env, converting HTTP URL to WebSocket: ${wsUrl}`,
					),
				);
			}

			return webSocket(wsUrl, {
				keepAlive: true,
				timeout: 60_000, // 60 seconds timeout
				reconnect: {
					attempts: 10,
					delay: 3000, // 3 seconds between attempts
				},
			});
		}
		return http(httpUrl);
	};

	// Create wallet client based on network
	let walletClient: WalletClient<Transport, Chain, Account>;
	let rpcUrl = config.rpcUrl;

	switch (network.toLowerCase()) {
		case "anvil":
			rpcUrl = rpcUrl || "http://127.0.0.1:8545";
			walletClient = createWalletClient({
				account,
				chain: foundry,
				transport: createTransport(rpcUrl),
			});
			break;
		case "basesepolia":
		case "base-sepolia":
			if (!rpcUrl) {
				throw new Error(
					"RPC_URL is required for base-sepolia network in .env file",
				);
			}
			walletClient = createWalletClient({
				account,
				chain: baseSepolia,
				transport: createTransport(rpcUrl),
			});
			break;
		case "sepolia":
			if (!rpcUrl) {
				throw new Error(
					"RPC_URL is required for sepolia network in .env file",
				);
			}
			walletClient = createWalletClient({
				account,
				chain: sepolia,
				transport: createTransport(rpcUrl),
			});
			break;
		default:
			throw new Error(
				`Unsupported network: ${network}. Supported: anvil, base-sepolia, sepolia`,
			);
	}

	console.log(chalk.gray(`  RPC URL: ${rpcUrl?.substring(0, 40)}...`));

	// Create alkahest client
	const alkahestClient = makeClient(walletClient);

	// Create optional domain-specific clients
	let commitObligationClient: ReturnType<
		typeof makeCommitObligationClient
	> | null = null;
	let gitIdentityRegistryClient: ReturnType<
		typeof makeGitIdentityRegistryClient
	> | null = null;

	if (config.commitObligationAddress) {
		console.log(
			chalk.gray(`  Commit Obligation: ${config.commitObligationAddress}`),
		);
		commitObligationClient = makeCommitObligationClient(
			alkahestClient.viemClient,
			{
				commitObligation: config.commitObligationAddress as `0x${string}`,
			},
		);
	}

	if (config.gitIdentityRegistryAddress) {
		console.log(
			chalk.gray(
				`  Git Identity Registry: ${config.gitIdentityRegistryAddress}`,
			),
		);
		gitIdentityRegistryClient = makeGitIdentityRegistryClient(
			alkahestClient.viemClient,
			{
				gitIdentityRegistry: config.gitIdentityRegistryAddress as `0x${string}`,
			},
		);
	}

	return {
		client: alkahestClient,
		commitObligationClient,
		gitIdentityRegistryClient,
		config,
		address,
		hasCommitObligation: !!config.commitObligationAddress,
		hasGitIdentityRegistry: !!config.gitIdentityRegistryAddress,
	};
}

/**
 * Check if .env file exists, load it into process.env, and show helpful error message if not found
 */
export function requireEnvFile(envPath: string = ".env"): void {
	if (!existsSync(envPath)) {
		console.error(chalk.red("❌ .env file not found"));
		console.error(
			chalk.yellow("\nPlease create a .env file with the following format:"),
		);
		console.error(chalk.gray("PRIVATE_KEY=0x1234567890abcdef..."));
		console.error(chalk.gray("NETWORK=anvil  # optional: anvil, base-sepolia, sepolia"));
		console.error(
			chalk.gray("RPC_URL=http://127.0.0.1:8545  # optional for anvil"),
		);
		console.error(chalk.gray("COMMIT_OBLIGATION_ADDRESS=0x...  # optional"));
		console.error(
			chalk.gray("GIT_IDENTITY_REGISTRY_ADDRESS=0x...  # optional"),
		);
		console.error(chalk.gray("DEBUG=true  # optional: enable verbose logging"));
		console.error(chalk.yellow("\nExample .env file:"));
		console.error(
			chalk.cyan(`PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
NETWORK=anvil
RPC_URL=http://127.0.0.1:8545
GIT_IDENTITY_REGISTRY_ADDRESS=0x...
DEBUG=true`),
		);
		process.exit(1);
	}

	// Load environment variables into process.env for use throughout the application
	const envVars = loadEnvFile(envPath);
	for (const [key, value] of Object.entries(envVars)) {
		// Don't override existing process.env variables (system env takes priority)
		if (!process.env[key]) {
			process.env[key] = value;
		}
	}
}

/**
 * Check if .env has all required fields for Git Key operations (register-key, check-key)
 */
export function validateGitKeyEnv(envPath: string = ".env"): void {
	requireEnvFile(envPath);

	try {
		const env = loadEnvFile(envPath);
		const missing: string[] = [];

		if (!env.PRIVATE_KEY) missing.push("PRIVATE_KEY");

		// Check if network has canonical addresses
		const network = (env.NETWORK || "anvil").toLowerCase();
		const normalizedNetwork =
			network === "basesepolia" ? "base-sepolia" : network;
		const hasCanonical = !!CANONICAL_ADDRESSES[normalizedNetwork];

		if (
			!hasCanonical &&
			(!env.GIT_IDENTITY_REGISTRY_ADDRESS ||
				env.GIT_IDENTITY_REGISTRY_ADDRESS.startsWith("#"))
		) {
			missing.push("GIT_IDENTITY_REGISTRY_ADDRESS");
		}

		if (missing.length > 0) {
			console.error(
				chalk.red(
					"❌ Missing required environment variables for Git Key operations:",
				),
			);
			for (const field of missing) {
				console.error(chalk.red(`   - ${field}`));
			}
			console.error(
				chalk.yellow(
					"\nPlease update your .env file or generate a new one with:",
				),
			);
			console.error(
				chalk.cyan("git-escrows new-client --privateKey 0x... --network anvil"),
			);
			console.error(
				chalk.yellow(
					"\nThen add the deployed GitIdentityRegistry contract address.",
				),
			);
			process.exit(1);
		}

		console.log(chalk.green("✅ Environment validated for Git Key operations"));
	} catch (error) {
		console.error(chalk.red("❌ Failed to validate .env file:"));
		console.error(
			chalk.red(error instanceof Error ? error.message : String(error)),
		);
		process.exit(1);
	}
}
