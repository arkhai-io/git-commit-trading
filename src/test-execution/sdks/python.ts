import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { BaseSdk } from './base.js';

export class PythonSdk extends BaseSdk {
  constructor() {
    super('python', '../alkahest-py');
  }

  async createOracleClient(): Promise<any> {
    console.log(`🔧 [Python SDK] Creating oracle client...`);
    
    try {
      // Create oracle client using Python subprocess
      // This would execute Python code to create the oracle client
      return {
        type: 'python-oracle',
        submitResult: async (result: boolean) => {
          console.log(`� [Python SDK] Submitting result: ${result}`);
          return await this.executePythonScript('submit_result', { result });
        }
      };
    } catch (error) {
      console.error("❌ [Python SDK] Failed to create oracle client:", error);
      throw error;
    }
  }

  async submitArbitrationResult(testResult: boolean, obligation: any, demand: any): Promise<boolean> {
    try {
      console.log(`� [Python SDK] Submitting arbitration result: ${testResult}`);
      console.log(`📁 Obligation: ${obligation[0].commitHash}`);
      console.log(`🧪 Demand: ${demand[0].testsCommitHash}`);
      
      // Create oracle client
      const oracleClient = await this.createOracleClient();
      
      // Submit result using Python oracle client
      const success = await oracleClient.submitResult(testResult);
      
      console.log(`✅ [Python SDK] Result submitted successfully: ${success}`);
      return success;
      
    } catch (error) {
      console.error("❌ [Python SDK] Error submitting result:", error);
      return false;
    }
  }

  private async executePythonScript(method: string, data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const pythonScript = path.join(this.sdkPath, 'oracle.py');
      const child = spawn('python3', [pythonScript, method, JSON.stringify(data)]);
      
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(stdout.trim());
            resolve(result);
          } catch (parseError) {
            resolve(stdout.trim());
          }
        } else {
          reject(new Error(`Python script failed with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  async encodeCommitTestsDemand(demand: any): Promise<string> {
    try {
      // Use Python SDK encoding
      return await this.executePythonScript('encode_demand', demand);
    } catch (error) {
      console.error("❌ [Python SDK] Error encoding demand:", error);
      return JSON.stringify(demand);
    }
  }

  getConfig(): any {
    return {
      sdkType: 'python',
      language: 'Python',
      runtime: 'Python 3.x'
    };
  }

  async validateSdk(): Promise<boolean> {
    try {
      // Check if Python is available and oracle.py exists
      const pythonScript = path.join(this.sdkPath, 'oracle.py');
      const result = await this.executePythonScript('validate', {});
      return result.valid === true;
    } catch (error) {
      console.error("❌ [Python SDK] Validation failed:", error);
      return false;
    }
  }
}
