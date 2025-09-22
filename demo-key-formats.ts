#!/usr/bin/env bun
/**
 * Demo script to show exactly what data format Bob registers on-chain
 * This shows the exact GitKeyClaim structure and data stored in the smart contract
 */

import chalk from 'chalk';
import { readFileSync, existsSync } from 'fs';
import { 
  extractPGPKeyMaterial,
  formatKeyForStorage,
  generatePGPKeyFingerprint
} from './src/utils/keyUtils.js';
import { extractSSHKeyMaterial } from './src/utils/gitUtils.js';
import { KeyType, createGitKeyClaim } from './src/clients/gitIdentityRegistry.js';

async function demonstrateKeyFormats() {
  console.log(chalk.blue('🔍 Demonstrating On-Chain Key Registration Data Formats\n'));
  
  // Test Address (Bob's address)
  const bobAddress = "0xED3e26ae83DFE09a75FbE9ee88F93168Cb68582b";
  const nonce = `register_key_${Date.now()}_demo`;
  const nonceHash = Buffer.from(nonce).toString('hex').padStart(64, '0');
  const demoSignature = '0x' + 'a'.repeat(128); // Mock signature for demo
  
  console.log(chalk.yellow('📋 Common GitKeyClaim Structure:'));
  console.log(chalk.gray('struct GitKeyClaim {'));
  console.log(chalk.gray('  uint8 keyType;        // 0=PGPv4, 1=SSHEd25519, 2=SSHSecp256k1, 3=X509'));
  console.log(chalk.gray('  bytes32 nonceHash;    // Hash of unique nonce for this registration'));
  console.log(chalk.gray('  bytes sig;            // Cryptographic signature proving key ownership'));
  console.log(chalk.gray('  string publicKey;     // Key material in specific format per key type'));
  console.log(chalk.gray('}\n'));
  
  // PGP Key Format
  console.log(chalk.blue('🔐 PGP Key Registration Format:'));
  
  const pgpKeyPath = './test-keys/public.asc';
  if (existsSync(pgpKeyPath)) {
    const pgpPublicKey = readFileSync(pgpKeyPath, 'utf-8');
    
    console.log(chalk.gray('Original PGP Key (armored format):'));
    console.log(chalk.gray(pgpPublicKey + '\n'));
    
    const pgpKeyMaterial = await extractPGPKeyMaterial(pgpPublicKey);
    const pgpFingerprint = await generatePGPKeyFingerprint(pgpPublicKey);
    
    console.log(chalk.green('Blockchain Storage Format (Base64):'));
    console.log(chalk.gray(`Length: ${pgpKeyMaterial.length} characters`));
    console.log(chalk.gray(`Data: ${pgpKeyMaterial}\n`));
    
    const pgpClaim = createGitKeyClaim(KeyType.PGPv4, nonceHash, demoSignature, pgpKeyMaterial);
    
    console.log(chalk.yellow('GitKeyClaim for PGP:'));
    console.log(chalk.gray(`  keyType: ${pgpClaim.keyType} (PGPv4)`));
    console.log(chalk.gray(`  nonceHash: ${pgpClaim.nonceHash}`));
    console.log(chalk.gray(`  sig: ${pgpClaim.sig}`));
    console.log(chalk.gray(`  publicKey: ${pgpClaim.publicKey}`));
    console.log(chalk.gray(`  fingerprint: ${pgpFingerprint}\n`));
  } else {
    console.log(chalk.yellow('⚠️ PGP test key not found, skipping PGP demo\n'));
  }
  
  // SSH Key Format
  console.log(chalk.blue('🔑 SSH Key Registration Format:'));
  
  const sshKeyPath = `${process.env.HOME}/.ssh/id_ed25519.pub`;
  if (existsSync(sshKeyPath)) {
    const sshPublicKey = readFileSync(sshKeyPath, 'utf-8').trim();
    
    console.log(chalk.gray('Original SSH Key:'));
    console.log(chalk.gray(sshPublicKey + '\n'));
    
    const sshKeyMaterial = extractSSHKeyMaterial(sshPublicKey);
    
    console.log(chalk.green('Blockchain Storage Format (Base64 key material only):'));
    console.log(chalk.gray(`Length: ${sshKeyMaterial.length} characters`));
    console.log(chalk.gray(`Data: ${sshKeyMaterial}\n`));
    
    const sshClaim = createGitKeyClaim(KeyType.SSHEd25519, nonceHash, demoSignature, sshKeyMaterial);
    
    console.log(chalk.yellow('GitKeyClaim for SSH:'));
    console.log(chalk.gray(`  keyType: ${sshClaim.keyType} (SSHEd25519)`));
    console.log(chalk.gray(`  nonceHash: ${sshClaim.nonceHash}`));
    console.log(chalk.gray(`  sig: ${sshClaim.sig.substring(0, 20)}...`));
    console.log(chalk.gray(`  publicKey: ${sshClaim.publicKey} (base64 key material only)`));
  } else {
    console.log(chalk.yellow('⚠️ SSH test key not found, skipping SSH demo\n'));
  }
  
  console.log(chalk.blue('📊 Summary of On-Chain Storage:'));
  console.log(chalk.gray('• Smart Contract: GitIdentityRegistry'));
  console.log(chalk.gray('• Event: GitKeyClaimed(address indexed claimant, GitKeyClaim claim)'));
  console.log(chalk.gray('• Storage: Mapping of address => latest GitKeyClaim'));
  console.log(chalk.gray('• PGP Format: Full key as base64-encoded binary data'));
  console.log(chalk.gray('• SSH Format: Only the base64 key material (no algorithm prefix/comment)'));
  console.log(chalk.gray('• Verification: Cryptographic signature proves key ownership'));
  console.log(chalk.gray('• Retrieval: Server fetches by address and auto-imports for Git verification'));
}

demonstrateKeyFormats().catch(console.error);