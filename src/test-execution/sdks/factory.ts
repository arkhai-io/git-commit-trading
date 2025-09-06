import { SdkType } from '../types.js';
import { BaseSdk } from './base.js';
import { TypeScriptSdk } from './typescript.js';
import { RustSdk } from './rust.js';
import { PythonSdk } from './python.js';

export class SdkFactory {
  /**
   * Create an SDK instance based on the specified type
   */
  static createSdk(sdkType: SdkType): BaseSdk {
    switch (sdkType) {
      case 'typescript':
        return new TypeScriptSdk();
      case 'rust':
        return new RustSdk();
      case 'python':
        return new PythonSdk();
      default:
        throw new Error(`Unsupported SDK type: ${sdkType}`);
    }
  }

  /**
   * Get all available SDK types
   */
  static getAvailableSdks(): SdkType[] {
    return ['typescript', 'rust', 'python'];
  }

  /**
   * Validate if an SDK type is supported
   */
  static isSdkSupported(sdkType: string): sdkType is SdkType {
    return ['typescript', 'rust', 'python'].includes(sdkType as SdkType);
  }

  /**
   * Validate all available SDKs
   */
  static async validateAllSdks(): Promise<Record<SdkType, boolean>> {
    const results: Record<SdkType, boolean> = {} as any;
    
    for (const sdkType of this.getAvailableSdks()) {
      try {
        const sdk = this.createSdk(sdkType);
        results[sdkType] = await sdk.validateSdk();
      } catch (error) {
        console.error(`❌ Failed to validate ${sdkType} SDK:`, error);
        results[sdkType] = false;
      }
    }
    
    return results;
  }
}
