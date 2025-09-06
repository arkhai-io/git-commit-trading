import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { BaseSdk } from './base.js';

export class RustSdk extends BaseSdk {
  constructor() {
    super('rust', '../alkahest-rs');
  }

  async createOracleClient(): Promise<any> {
    console.log(`🔧 [Rust SDK] Creating oracle client...`);
    
    try {
      // Create oracle client using Rust binary
      // This would execute the Rust oracle binary to create the client
      return {
        type: 'rust-oracle',
        submitResult: async (result: boolean) => {
          console.log(`📤 [Rust SDK] Submitting result: ${result}`);
          return await this.executeRustBinary('submit_result', { result });
        }
      };
    } catch (error) {
      console.error("❌ [Rust SDK] Failed to create oracle client:", error);
      throw error;
    }
  }

  async submitArbitrationResult(testResult: boolean, obligation: any, demand: any): Promise<boolean> {
    try {
      console.log(`� [Rust SDK] Submitting arbitration result: ${testResult}`);
      console.log(`📁 Obligation: ${obligation[0].commitHash}`);
      console.log(`🧪 Demand: ${demand[0].testsCommitHash}`);
      
      // Create oracle client
      const oracleClient = await this.createOracleClient();
      
      // Submit result using Rust oracle client
      const success = await oracleClient.submitResult(testResult);
      
      console.log(`✅ [Rust SDK] Result submitted successfully: ${success}`);
      return success;
      
    } catch (error) {
      console.error("❌ [Rust SDK] Error submitting result:", error);
      return false;
    }
  }

  private async executeRustBinary(command: string, data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const rustProcess = spawn('cargo', ['run', '--bin', 'oracle', command, JSON.stringify(data)], {
        cwd: path.resolve(process.cwd(), this.sdkPath),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });
      
      let stdout = '';
      let stderr = '';

      rustProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      rustProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      rustProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(stdout.trim());
            resolve(result);
          } catch (parseError) {
            resolve(stdout.trim());
          }
        } else {
          reject(new Error(`Rust binary failed with code ${code}: ${stderr}`));
        }
      });

      rustProcess.on('error', (error) => {
        reject(error);
      });
    });
  }

  async encodeCommitTestsDemand(demand: any): Promise<string> {
    try {
      // Use Rust SDK encoding
      return await this.executeRustBinary('encode_demand', demand);
    } catch (error) {
      console.error("❌ [Rust SDK] Error encoding demand:", error);
      return JSON.stringify(demand);
    }
  }

  getConfig(): any {
    return {
      sdkType: 'rust',
      language: 'Rust',
      runtime: 'Native Binary'
    };
  }

  async validateSdk(): Promise<boolean> {
    try {
      // Check if Cargo.toml exists in the Rust SDK directory
      const cargoPath = path.resolve(process.cwd(), this.sdkPath, 'Cargo.toml');
      await fs.access(cargoPath);
      
      // Test if cargo is available
      return new Promise((resolve) => {
        const testProcess = spawn('cargo', ['--version'], {
          cwd: path.resolve(process.cwd(), this.sdkPath),
          stdio: 'pipe'
        });
        
        testProcess.on('close', (code) => {
          resolve(code === 0);
        });
        
        testProcess.on('error', () => {
          resolve(false);
        });
      });
    } catch (error) {
      console.error("❌ [Rust SDK] Validation failed:", error);
      return false;
    }
  }
}
