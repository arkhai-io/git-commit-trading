import chalk from 'chalk';
import { getGitVerificationService } from '../../services/verificationService.js';

interface ClearCacheOptions {
  commit?: string;
  repo?: string;
  keys?: boolean;
  all?: boolean;
}

export async function clearCacheCommand(options: ClearCacheOptions) {
  try {
    console.log(chalk.blue('Clearing verification cache...'));
    
    const gitVerificationService = getGitVerificationService();
    
    if (options.all) {
      gitVerificationService.clearCache();
      console.log(chalk.green('✅ All verification cache cleared'));
    } else if (options.commit && options.repo) {
      gitVerificationService.clearCommitCache(options.repo, options.commit);
      console.log(chalk.green('✅ Commit verification cache cleared'));
    } else if (options.keys) {
      // Clear only key import cache
      gitVerificationService.clearCache();
      console.log(chalk.green('✅ Key import cache cleared'));
    } else {
      console.log(chalk.yellow('Please specify what to clear:'));
      console.log(chalk.yellow('  --all: Clear all caches'));
      console.log(chalk.yellow('  --commit <hash> --repo <url>: Clear specific commit cache'));
      console.log(chalk.yellow('  --keys: Clear key import cache'));
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Failed to clear cache:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}