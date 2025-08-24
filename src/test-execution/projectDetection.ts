import { promises as fs } from 'fs';
import path from 'path';

export interface PackageJsonCommands {
  installCommand: string;
  buildCommand: string;
  testCommand: string;
}

export interface ProjectDetectionResult {
  isTypeScriptProject: boolean;
  hasPackageJson: boolean;
  commands: PackageJsonCommands | null;
  error?: string;
}

/**
 * Detects if a directory contains a TypeScript project with package.json
 * and extracts the necessary commands
 */
export async function detectProjectCommands(projectPath: string): Promise<ProjectDetectionResult> {
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');
    
    // Check if package.json exists
    try {
      await fs.access(packageJsonPath);
    } catch (error) {
      return {
        isTypeScriptProject: false,
        hasPackageJson: false,
        commands: null,
        error: 'No package.json found in the project directory'
      };
    }

    // Read and parse package.json
    let packageJson: any;
    try {
      const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
      packageJson = JSON.parse(packageJsonContent);
    } catch (error) {
      return {
        isTypeScriptProject: false,
        hasPackageJson: true,
        commands: null,
        error: 'Failed to parse package.json: ' + (error as Error).message
      };
    }

    // Check if it's a TypeScript project
    const isTypeScriptProject = await checkIsTypeScriptProject(projectPath, packageJson);
    
    if (!isTypeScriptProject) {
      return {
        isTypeScriptProject: false,
        hasPackageJson: true,
        commands: null,
        error: 'Project is not detected as a TypeScript project'
      };
    }

    // Extract commands from scripts
    const scripts = packageJson.scripts || {};
    const commands = extractCommands(scripts);

    if (!commands) {
      return {
        isTypeScriptProject: true,
        hasPackageJson: true,
        commands: null,
        error: 'Required scripts (install/build/test) not found in package.json'
      };
    }

    return {
      isTypeScriptProject: true,
      hasPackageJson: true,
      commands,
      error: undefined
    };

  } catch (error) {
    return {
      isTypeScriptProject: false,
      hasPackageJson: false,
      commands: null,
      error: 'Failed to detect project: ' + (error as Error).message
    };
  }
}

/**
 * Checks if the project is a TypeScript project by looking for TypeScript indicators
 */
async function checkIsTypeScriptProject(projectPath: string, packageJson: any): Promise<boolean> {
  // Check 1: TypeScript in dependencies or devDependencies
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  if (dependencies.typescript || dependencies['@types/node']) {
    return true;
  }

  // Check 2: tsconfig.json exists
  try {
    await fs.access(path.join(projectPath, 'tsconfig.json'));
    return true;
  } catch (error) {
    // tsconfig.json doesn't exist, continue checking
  }

  // Check 3: TypeScript files exist
  try {
    const files = await fs.readdir(projectPath);
    const hasTypeScriptFiles = files.some(file => 
      file.endsWith('.ts') || file.endsWith('.tsx')
    );
    if (hasTypeScriptFiles) {
      return true;
    }

    // Check in src directory
    try {
      const srcPath = path.join(projectPath, 'src');
      const srcFiles = await fs.readdir(srcPath);
      const hasSrcTypeScriptFiles = srcFiles.some(file => 
        file.endsWith('.ts') || file.endsWith('.tsx')
      );
      if (hasSrcTypeScriptFiles) {
        return true;
      }
    } catch (error) {
      // src directory doesn't exist, that's fine
    }

  } catch (error) {
    // Could not read directory
  }

  return false;
}

/**
 * Extracts install, build, and test commands from package.json scripts
 */
function extractCommands(scripts: Record<string, string>): PackageJsonCommands | null {
  // Determine install command - keep as default since it's not typically in scripts
  let installCommand = 'npm install'; // Default fallback

  // Determine build command - use exact script value
  let buildCommand: string | null = null;
  const buildCandidates = ['build', 'compile', 'tsc', 'webpack'];
  for (const candidate of buildCandidates) {
    if (scripts[candidate]) {
      buildCommand = scripts[candidate]; // Use exact script value
      break;
    }
  }

  // If no build script found, try common TypeScript build patterns
  if (!buildCommand) {
    if (scripts.prepare && scripts.prepare.includes('tsc')) {
      buildCommand = scripts.prepare; // Use exact script value
    } else if (scripts.prepublish && scripts.prepublish.includes('tsc')) {
      buildCommand = scripts.prepublish; // Use exact script value
    }
  }

  // Determine test command - use exact script value
  let testCommand: string | null = null;
  const testCandidates = ['test', 'test:unit', 'test:all', 'jest', 'mocha', 'vitest'];
  for (const candidate of testCandidates) {
    if (scripts[candidate]) {
      testCommand = scripts[candidate]; // Use exact script value
      break;
    }
  }

  // Check if we found all required commands
  if (!buildCommand || !testCommand) {
    return null;
  }

  return {
    installCommand,
    buildCommand,
    testCommand
  };
}

/**
 * Detects the package manager used in the project
 */
export async function detectPackageManager(projectPath: string): Promise<'npm' | 'yarn' | 'pnpm' | 'bun'> {
  try {
    // Check for lock files to determine package manager
    const lockFiles = [
      { file: 'bun.lockb', manager: 'bun' as const },
      { file: 'pnpm-lock.yaml', manager: 'pnpm' as const },
      { file: 'yarn.lock', manager: 'yarn' as const },
      { file: 'package-lock.json', manager: 'npm' as const },
    ];

    for (const { file, manager } of lockFiles) {
      try {
        await fs.access(path.join(projectPath, file));
        return manager;
      } catch (error) {
        // Lock file doesn't exist, continue
      }
    }

    // Default to npm if no lock files found
    return 'npm';
  } catch (error) {
    return 'npm';
  }
}

/**
 * Updates commands to use the detected package manager
 */
export function updateCommandsForPackageManager(
  commands: PackageJsonCommands, 
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun'
): PackageJsonCommands {
  const installCommand = packageManager === 'npm' ? 'npm install' :
                        packageManager === 'yarn' ? 'yarn install' :
                        packageManager === 'pnpm' ? 'pnpm install' :
                        'bun install';

  // Keep build and test commands exactly as they are from package.json scripts
  // since they now contain the raw command values
  return {
    installCommand,
    buildCommand: commands.buildCommand,
    testCommand: commands.testCommand
  };
}
