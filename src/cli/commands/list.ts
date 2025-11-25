import chalk from 'chalk';
import { createClientFromEnv, requireEnvFile } from '../utils/envLoader.js';
import type { CommitObligationAddresses } from '../../clients/commitObligation';
import { parseAbiItem, decodeAbiParameters, parseAbiParameters, type Address } from 'viem';

interface ListOptions {
  status?: string;
  limit?: string;
  format?: string;
  verbose?: boolean;
  address?: string;
}

interface EscrowData {
  uid: string;
  status: 'open' | 'fulfilled' | 'expired' | 'unknown';
  buyer: string;
  recipient: string;
  amount: string;
  token: string;
  arbiter: string;
  created: string;
  txHash: string;
  blockNumber: number;
  expirationTime: number;
}

export async function listCommand(options: ListOptions) {
  try {
    console.log(chalk.blue('🔍 Fetching available escrows from blockchain...'));
    
    const limit = parseInt(options.limit || '20');
    const status = options.status?.toLowerCase();
    const format = options.format?.toLowerCase() || 'table';
    const verbose = options.verbose || false;
    const filterAddress = options.address?.toLowerCase();

    // Check for .env file and load client
    requireEnvFile();
    
    console.log(chalk.gray('Setting up blockchain client...'));
    const { client, config } = await createClientFromEnv();

    const viemClient = client.viemClient;
    const erc20EscrowAddress = client.contractAddresses.erc20EscrowObligation;

    if (!erc20EscrowAddress || erc20EscrowAddress === '0x0000000000000000000000000000000000000000') {
      console.log(chalk.yellow('\n⚠️  No ERC20EscrowObligation address configured'));
      console.log(chalk.gray('Please add the following to your .env file:'));
      console.log(chalk.gray('ERC20_ESCROW_OBLIGATION_ADDRESS=0x...'));
      console.log(chalk.gray('\nYou can find the deployed address in:'));
      console.log(chalk.gray('  contract/deployments/[network].json'));
      throw new Error('ERC20_ESCROW_OBLIGATION_ADDRESS required');
    }

    console.log(chalk.gray(`ERC20 Escrow Contract: ${erc20EscrowAddress}`));
    console.log(chalk.gray('Querying blockchain for escrow events...'));
    
    // Get current block number for filtering
    const currentBlock = await viemClient.getBlockNumber();
    const fromBlock = currentBlock - BigInt(100000); // Look back 100k blocks

    console.log(chalk.gray(`Scanning blocks ${fromBlock} to ${currentBlock}...`));

    const escrows: EscrowData[] = [];

    try {
      // Query for Attested events from EAS where attester is ERC20EscrowObligation
      // This represents escrow creations
      const attestedLogs = await viemClient.getLogs({
        address: client.contractAddresses.eas as Address,
        event: parseAbiItem('event Attested(address indexed recipient, address indexed attester, bytes32 uid, bytes32 indexed schemaUID)'),
        args: {
          attester: erc20EscrowAddress as Address,
        },
        fromBlock,
        toBlock: currentBlock,
      });

      console.log(chalk.green(`✓ Found ${attestedLogs.length} escrow attestation(s)`));

      // Query for EscrowCollected events to determine fulfilled escrows
      const collectedLogs = await viemClient.getLogs({
        address: erc20EscrowAddress as Address,
        event: parseAbiItem('event EscrowCollected(bytes32 indexed escrow, bytes32 indexed fulfillment, address indexed fulfiller)'),
        fromBlock,
        toBlock: currentBlock,
      });

      const collectedEscrows = new Set(
        collectedLogs.map((log: any) => log.args.escrow)
      );

      console.log(chalk.green(`✓ Found ${collectedLogs.length} collected escrow(s)`));

      // Process each attestation to get full escrow details
      for (const log of attestedLogs) {
        try {
          const { recipient, uid } = log.args;
          
          // Get the full attestation data from EAS
          const attestation = await client.getAttestation(uid as `0x${string}`);
          
          // Check if attestation data looks valid (should be longer than just the selector)
          if (!attestation.data || attestation.data === '0x' || attestation.data.length < 10) {
            console.log(chalk.yellow(`  Warning: Skipping escrow ${uid} - empty or invalid data`));
            continue;
          }
          
          // Debug: print first 200 chars of data for the first few escrows
          if (verbose && escrows.length < 3) {
            console.log(chalk.gray(`  Debug UID ${uid}:`));
            console.log(chalk.gray(`    Data length: ${attestation.data.length}`));
            console.log(chalk.gray(`    Data: ${attestation.data.substring(0, 200)}...`));
          }
          
          // Decode the escrow obligation data structure
          // Schema: struct ObligationData { address arbiter; bytes demand; address token; uint256 amount; }
          const escrowAbi = parseAbiParameters('(address arbiter, bytes demand, address token, uint256 amount)');
          const decoded = decodeAbiParameters(escrowAbi, attestation.data);
          
          const arbiter = decoded[0].arbiter as Address;
          const demand = decoded[0].demand as `0x${string}`;
          const token = decoded[0].token as Address;
          const amount = decoded[0].amount as bigint;

          // Determine status
          let escrowStatus: 'open' | 'fulfilled' | 'expired' | 'unknown' = 'open';
          
          if (collectedEscrows.has(uid)) {
            escrowStatus = 'fulfilled';
          } else if (attestation.expirationTime > 0 && BigInt(attestation.expirationTime) < BigInt(Math.floor(Date.now() / 1000))) {
            escrowStatus = 'expired';
          } else if (attestation.revocationTime > 0) {
            escrowStatus = 'fulfilled'; // Revoked means collected
          }

          // Apply address filter if specified
          if (filterAddress && 
              recipient.toLowerCase() !== filterAddress && 
              attestation.attester.toLowerCase() !== filterAddress) {
            continue;
          }

          // Get block details for timestamp
          const block = await viemClient.getBlock({ blockNumber: log.blockNumber });

          const escrowData: EscrowData = {
            uid: uid as string,
            status: escrowStatus,
            buyer: recipient as string,
            recipient: attestation.recipient,
            amount: amount.toString(),
            token: token as string,
            arbiter: arbiter as string,
            created: new Date(Number(block.timestamp) * 1000).toISOString(),
            txHash: log.transactionHash as string,
            blockNumber: Number(log.blockNumber),
            expirationTime: Number(attestation.expirationTime),
          };

          escrows.push(escrowData);
        } catch (error) {
          if (verbose) {
            console.log(chalk.yellow(`  Warning: Could not process escrow ${log.args.uid}:`));
            console.log(chalk.gray(`    ${error instanceof Error ? error.message : String(error)}`));
          }
          // Skip this escrow and continue with the next one
          continue;
        }
      }

      console.log(chalk.green(`✓ Processed ${escrows.length} escrow(s) successfully`));
      
    } catch (error) {
      console.error(chalk.red('Error querying escrow events:'));
      console.error(error);
      throw error;
    }

    // Apply status filter if specified
    const filteredEscrows = status 
      ? escrows.filter(escrow => escrow.status === status)
      : escrows;

    // Apply limit
    const limitedEscrows = filteredEscrows.slice(0, limit);

    console.log(chalk.green(`\n✓ Found ${limitedEscrows.length} escrow(s) matching criteria`));

    if (limitedEscrows.length === 0) {
      console.log(chalk.yellow('No escrows found matching the specified criteria.'));
      return;
    }

    // Format and display results based on format option
    if (format === 'json') {
      console.log(JSON.stringify(limitedEscrows, null, 2));
      return;
    }

    if (format === 'csv') {
      console.log('uid,status,buyer,recipient,amount,token,arbiter,created,expirationTime,txHash,blockNumber');
      limitedEscrows.forEach(escrow => {
        console.log(`${escrow.uid},${escrow.status},${escrow.buyer},${escrow.recipient},${escrow.amount},${escrow.token},${escrow.arbiter},${escrow.created},${escrow.expirationTime},${escrow.txHash},${escrow.blockNumber}`);
      });
      return;
    }

    // Table format (default)
    console.log(chalk.white('\nAvailable Escrows:'));
    console.log(chalk.gray('─'.repeat(100)));
    
    limitedEscrows.forEach((escrow, index) => {
      console.log(chalk.green(`${index + 1}. UID: ${escrow.uid.substring(0, 16)}...`));
      console.log(chalk.green(`   Status: ${getStatusIcon(escrow.status)} ${escrow.status.toUpperCase()}`));
      console.log(chalk.gray(`   Amount: ${formatWeiToEth(escrow.amount)} tokens`));
      console.log(chalk.gray(`   Token: ${escrow.token}`));
      console.log(chalk.gray(`   Buyer: ${escrow.buyer}`));
      console.log(chalk.gray(`   Arbiter: ${escrow.arbiter}`));
      
      if (verbose) {
        console.log(chalk.gray(`   Recipient: ${escrow.recipient}`));
        console.log(chalk.gray(`   Raw Amount: ${escrow.amount} wei`));
        console.log(chalk.gray(`   Created: ${escrow.created}`));
        console.log(chalk.gray(`   Expiration: ${escrow.expirationTime === 0 ? 'Never' : new Date(escrow.expirationTime * 1000).toISOString()}`));
        console.log(chalk.gray(`   Tx Hash: ${escrow.txHash}`));
        console.log(chalk.gray(`   Block: ${escrow.blockNumber}`));
      }
      console.log();
    });

    // Show summary
    const statusCounts = limitedEscrows.reduce((acc, escrow) => {
      acc[escrow.status] = (acc[escrow.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log(chalk.blue('Summary:'));
    for (const [statusType, count] of Object.entries(statusCounts)) {
      console.log(chalk.gray(`   ${getStatusIcon(statusType)} ${statusType}: ${count}`));
    }

    console.log(chalk.blue('\nOptions:'));
    console.log(chalk.gray('• Use --verbose flag for detailed information'));
    console.log(chalk.gray('• Use --format json|csv for different output formats'));
    console.log(chalk.gray('• Use --status open|fulfilled|expired to filter by status'));
    console.log(chalk.gray('• Use --address 0x... to filter by buyer/recipient address'));
    console.log(chalk.gray('• Use --limit N to limit number of results (default: 20)'));

  } catch (error) {
    console.error(chalk.red('Failed to list escrows:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    
    console.log(chalk.yellow('\n💡 Troubleshooting tips:'));
    console.log(chalk.gray('• Make sure your .env file is properly configured'));
    console.log(chalk.gray('• Ensure your RPC endpoint is accessible'));
    console.log(chalk.gray('• Check that your private key and address are correct'));
    
    throw error; // Let the CLI handle the exit
  }
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'open':
      return '[O]';
    case 'fulfilled':
      return '[X]';
    case 'expired':
      return '[E]';
    default:
      return '[?]';
  }
}

function formatWeiToEth(weiAmount: string): string {
  try {
    const wei = BigInt(weiAmount);
    const eth = wei / BigInt('1000000000000000000'); // 1e18
    const remainder = wei % BigInt('1000000000000000000');
    
    if (remainder === BigInt(0)) {
      return eth.toString();
    } else {
      // Simple decimal formatting - convert remainder to decimal
      const decimal = remainder.toString().padStart(18, '0');
      const trimmedDecimal = decimal.replace(/0+$/, ''); // Remove trailing zeros
      return `${eth.toString()}.${trimmedDecimal}`;
    }
  } catch (error) {
    return `${weiAmount} wei`;
  }
}
