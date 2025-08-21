import chalk from 'chalk';
import { parseAbiParameters } from 'viem';
import { setupTest } from '../../../tests/utils/setup.js';

interface ListOptions {
  status?: string;
  limit?: string;
  format?: string;
  verbose?: boolean;
}

export async function listCommand(options: ListOptions) {
  try {
    console.log(chalk.blue('Fetching available escrows...'));
    
    const limit = parseInt(options.limit || '20');
    const status = options.status?.toLowerCase();
    const format = options.format?.toLowerCase() || 'table';
    const verbose = options.verbose || false;

    // Setup test environment to get clients
    console.log(chalk.gray('Setting up blockchain environment...'));
    const setup = await setupTest();
    const testContext = setup.testContext;
    const aliceClient = setup.aliceClient;

    console.log(chalk.gray('Querying escrows from blockchain...'));

    // Get escrows from the ERC20 escrow contract
    const escrowContract = testContext.addresses.erc20EscrowObligation;
    
    // Query recent events to get escrows
    // We'll look for AttestationMade events which indicate new escrows
    const logs = await testContext.testClient.getLogs({
      address: escrowContract,
      fromBlock: 'earliest',
      toBlock: 'latest',
    });

    if (logs.length === 0) {
      console.log(chalk.yellow('No escrows found.'));
      console.log(chalk.gray('Create your first escrow with: git-escrows submit'));
      process.exit(0);
    }

    console.log(chalk.green(`Found ${logs.length} escrow events`));

    // Process and filter escrows
    const escrows = [];
    
    for (let i = 0; i < Math.min(logs.length, limit); i++) {
      const log = logs[i];
      
      if (!log) continue; // Skip if log is undefined
      
      try {
        // Try to get escrow details
        const escrowInfo = {
          blockNumber: Number(log.blockNumber),
          transactionHash: log.transactionHash,
          address: log.address,
          topics: log.topics,
          data: log.data,
        };

        // Try to decode if it's an AttestationMade event
        if (log.topics[0]) {
          escrows.push({
            id: `${log.blockNumber}-${log.logIndex}`,
            uid: log.topics[1] || 'N/A',
            attester: log.address,
            blockNumber: Number(log.blockNumber),
            transactionHash: log.transactionHash,
            status: 'Open', // Default status
            timestamp: new Date().toISOString(), // We'd need to get this from block
          });
        }
      } catch (error) {
        if (verbose) {
          console.log(chalk.gray(`Skipping log at block ${log.blockNumber}: ${error}`));
        }
      }
    }

    if (escrows.length === 0) {
      console.log(chalk.yellow('No valid escrows found.'));
      return;
    }

    // Filter by status if specified
    let filteredEscrows = escrows;
    if (status) {
      filteredEscrows = escrows.filter(e => 
        e.status.toLowerCase().includes(status) || 
        (status === 'open' && e.status === 'Open')
      );
    }

    // Display results
    console.log(chalk.white(`\nEscrows (${filteredEscrows.length} found):`));
    
    if (format === 'json') {
      console.log(JSON.stringify(filteredEscrows, null, 2));
    } else if (format === 'csv') {
      console.log('ID,UID,Attester,Status,Block,Transaction');
      filteredEscrows.forEach(escrow => {
        console.log(`${escrow.id},${escrow.uid},${escrow.attester},${escrow.status},${escrow.blockNumber},${escrow.transactionHash}`);
      });
    } else {
      // Table format (default)
      console.log(chalk.gray('─'.repeat(120)));
      console.log(chalk.cyan(
        'ID'.padEnd(12) + 
        'UID'.padEnd(20) + 
        'Attester'.padEnd(44) + 
        'Status'.padEnd(10) + 
        'Block'.padEnd(10) + 
        'Transaction'
      ));
      console.log(chalk.gray('─'.repeat(120)));
      
      filteredEscrows.forEach(escrow => {
        const truncatedUid = escrow.uid.length > 18 ? 
          escrow.uid.substring(0, 15) + '...' : 
          escrow.uid;
        const truncatedAttester = escrow.attester.length > 42 ? 
          escrow.attester.substring(0, 39) + '...' : 
          escrow.attester;
        const truncatedTx = escrow.transactionHash.length > 20 ? 
          escrow.transactionHash.substring(0, 17) + '...' : 
          escrow.transactionHash;
          
        const statusColor = escrow.status === 'Open' ? chalk.green : 
                           escrow.status === 'Fulfilled' ? chalk.yellow : 
                           escrow.status === 'Completed' ? chalk.blue : chalk.gray;
        
        console.log(
          escrow.id.padEnd(12) + 
          truncatedUid.padEnd(20) + 
          truncatedAttester.padEnd(44) + 
          statusColor(escrow.status.padEnd(10)) + 
          escrow.blockNumber.toString().padEnd(10) + 
          truncatedTx
        );
        
        if (verbose) {
          console.log(chalk.gray(`    Full UID: ${escrow.uid}`));
          console.log(chalk.gray(`    Full Attester: ${escrow.attester}`));
          console.log(chalk.gray(`    Full Transaction: ${escrow.transactionHash}`));
          console.log('');
        }
      });
      console.log(chalk.gray('─'.repeat(120)));
    }

    // Show summary and helpful commands
    console.log(chalk.yellow('\nUseful commands:'));
    console.log(chalk.gray('  • Fulfill an escrow: git-escrows fulfill --escrow-uid <UID>'));
    console.log(chalk.gray('  • Filter by status: git-escrows list --status open'));
    console.log(chalk.gray('  • Verbose output: git-escrows list --verbose'));
    console.log(chalk.gray('  • JSON format: git-escrows list --format json'));
    
    if (filteredEscrows.length > 0) {
      console.log(chalk.yellow('\nQuick fulfill command for latest escrow:'));
      const latestEscrow = filteredEscrows[0];
      if (latestEscrow) {
        console.log(chalk.cyan(`git-escrows fulfill --escrow-uid "${latestEscrow.uid}" --solution-repo "YOUR_REPO" --solution-commit "YOUR_COMMIT"`));
      }
    }

    // Exit successfully
    process.exit(0);

  } catch (error) {
    console.error(chalk.red('Failed to list escrows:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    
    if (error instanceof Error && error.message.includes('network')) {
      console.log(chalk.yellow('\nTip: Make sure your blockchain environment is running'));
      console.log(chalk.gray('Try running the arbiter server first: git-escrows server'));
    }
    
    process.exit(1);
  }
}
