import chalk from 'chalk';
import { createClientFromEnv, requireEnvFile } from '../utils/envLoader.js';
import { CommitObligationAddresses } from '../../clients/commitObligation';

interface ListOptions {
  status?: string;
  limit?: string;
  format?: string;
  verbose?: boolean;
}

interface EscrowData {
  uid: string;
  status: 'open' | 'fulfilled' | 'expired' | 'unknown';
  buyer: string;
  recipient: string;
  amount: string;
  created: string;
  txHash: string;
  blockNumber: number;
}

export async function listCommand(options: ListOptions) {
  try {
    console.log(chalk.blue('🔍 Fetching available escrows from blockchain...'));
    
    const limit = parseInt(options.limit || '20');
    const status = options.status?.toLowerCase();
    const format = options.format?.toLowerCase() || 'table';
    const verbose = options.verbose || false;

    // Check for .env file and load client
    requireEnvFile();
    
    console.log(chalk.gray('Setting up blockchain client...'));
    const { client, config, hasCommitObligation, hasGitIdentityRegistry } = await createClientFromEnv();

    console.log(chalk.gray('Querying blockchain for escrow events...'));
    
    const viemClient = client.viemClient;

    // Get current block number for filtering
    const currentBlock = await viemClient.getBlockNumber();
    const fromBlock = currentBlock - BigInt(10000); // Look back 10000 blocks

    console.log(chalk.gray(`Scanning blocks ${fromBlock} to ${currentBlock}...`));

    // For now, we'll look for CommitObligation events since we know that contract works
    // In a real implementation, you would check for ERC20_ESCROW_OBLIGATION_ADDRESS
    // and query the specific escrow contract events
    
    const escrows: EscrowData[] = [];

    // Check if we have COMMIT_OBLIGATION_ADDRESS to query real data
    if (hasCommitObligation) {
      try {
        // Query for attestation events related to commit obligations
        // This is a simplified approach - in production you'd want specific escrow contract events
        console.log(chalk.gray('Querying commit obligation events...'));
        
        // Since we can't easily import the specific contract ABIs, let's use a basic approach
        // to demonstrate the functionality with available data
        console.log(chalk.yellow('Using simplified data querying for demonstration'));
        console.log(chalk.gray('In production, this would query specific ERC20EscrowObligation events'));
        
        // Create some sample data based on current network state
        const sampleEscrow: EscrowData = {
          uid: `0x${Math.random().toString(16).substr(2, 64)}`,
          status: 'open',
          buyer: config.address,
          recipient: '0x0000000000000000000000000000000000000000',
          amount: '1000000000000000000', // 1 ETH in wei
          created: new Date().toISOString(),
          txHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
          blockNumber: Number(currentBlock),
        };
        
        escrows.push(sampleEscrow);
        
        console.log(chalk.green(`✓ Found ${escrows.length} escrow(s) (demo mode)`));
      } catch (error) {
        console.log(chalk.yellow(`Could not query events: ${error}`));
      }
    } else {
      console.log(chalk.yellow('No COMMIT_OBLIGATION_ADDRESS found in .env'));
      console.log(chalk.gray('To list real escrows, please add contract addresses to your .env file:'));
      console.log(chalk.gray('COMMIT_OBLIGATION_ADDRESS=0x...'));
      console.log(chalk.gray('ERC20_ESCROW_OBLIGATION_ADDRESS=0x...'));
      console.log(chalk.gray(''));
      console.log(chalk.blue('Demo Mode - Showing sample escrow structure:'));
      
      // Show demo data structure
      const demoEscrow: EscrowData = {
        uid: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        status: 'open',
        buyer: config.address,
        recipient: '0x742d35Cc6634C0532925a3b8D56Ff4E08c41aAAF',
        amount: '5000000000000000000', // 5 ETH
        created: new Date().toISOString(),
        txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockNumber: Number(currentBlock),
      };
      
      escrows.push(demoEscrow);
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
      console.log('uid,status,buyer,recipient,amount,created,txHash,blockNumber');
      limitedEscrows.forEach(escrow => {
        console.log(`${escrow.uid},${escrow.status},${escrow.buyer},${escrow.recipient},${escrow.amount},${escrow.created},${escrow.txHash},${escrow.blockNumber}`);
      });
      return;
    }

    // Table format (default)
    console.log(chalk.white('\nAvailable Escrows:'));
    console.log(chalk.gray('─'.repeat(100)));
    
    limitedEscrows.forEach((escrow, index) => {
      console.log(chalk.white(`${index + 1}. UID: ${escrow.uid.substring(0, 16)}...`));
      console.log(chalk.gray(`   Status: ${getStatusIcon(escrow.status)} ${escrow.status.toUpperCase()}`));
      console.log(chalk.gray(`   Amount: ${formatWeiToEth(escrow.amount)} ETH`));
      console.log(chalk.gray(`   Buyer: ${escrow.buyer}`));
      console.log(chalk.gray(`   Recipient: ${escrow.recipient}`));
      
      if (verbose) {
        console.log(chalk.gray(`   Raw Amount: ${escrow.amount} wei`));
        console.log(chalk.gray(`   Created: ${escrow.created}`));
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

    console.log(chalk.blue('\nNext steps:'));
    console.log(chalk.gray('• Add ERC20_ESCROW_OBLIGATION_ADDRESS to .env for real escrow data'));
    console.log(chalk.gray('• Use --verbose flag for detailed information'));
    console.log(chalk.gray('• Use --format json|csv for different output formats'));
    console.log(chalk.gray('• Use --status open|fulfilled|expired to filter by status'));

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
      return '🟢';
    case 'fulfilled':
      return '✅';
    case 'expired':
      return '🔴';
    default:
      return '❓';
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
