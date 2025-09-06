export interface ArbitrationInput {
  obligation: any;
  demand: any;
}

export interface ArbitrationResult {
  success: boolean;
  error?: string;
  duration: number;
}

export abstract class BaseSdk {
  protected sdkType: string;
  protected sdkPath: string;

  constructor(sdkType: string, sdkPath: string) {
    this.sdkType = sdkType;
    this.sdkPath = sdkPath;
  }

  /**
   * Create oracle client using the specific SDK
   */
  abstract createOracleClient(): Promise<any>;

  /**
   * Submit arbitration result to the blockchain using the SDK's oracle client
   */
  abstract submitArbitrationResult(testResult: boolean, obligation: any, demand: any): Promise<boolean>;

  /**
   * Encode commit tests demand according to the SDK format
   */
  abstract encodeCommitTestsDemand(demand: any): Promise<string>;

  /**
   * Get SDK-specific configuration
   */
  abstract getConfig(): any;

  /**
   * Validate SDK availability
   */
  abstract validateSdk(): Promise<boolean>;
}
