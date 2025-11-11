import { promises as fs } from 'fs';
import path from 'path';
import type { ProjectLanguage } from './types.js';

export interface PackageJsonCommands {
  installCommand: string;
  buildCommand: string;
  testCommand: string;
}

export interface CargoCommands {
  installCommand: string;
  buildCommand: string;
  testCommand: string;
}

export interface PythonCommands {
  installCommand: string;
  buildCommand: string;
  testCommand: string;
}

export type ProjectCommands = PackageJsonCommands | CargoCommands | PythonCommands;

export interface ProjectDetectionResult {
  language: ProjectLanguage | null;
  isValidProject: boolean;
  hasConfigFile: boolean;
  commands: ProjectCommands | null;
  error?: string;
}

/**
 * Detects the project language and extracts the necessary commands
 */
export async function detectProjectCommands(projectPath: string): Promise<ProjectDetectionResult> {
  try {
    // Get all results first to make intelligent priority decisions
    const tsResult = await detectTypeScriptProject(projectPath);
    const rustResult = await detectRustProject(projectPath);
    const pythonResult = await detectPythonProject(projectPath);
    
    // Smart priority logic:
    // 1. If only one type is detected, use that
    // 2. If multiple types are detected, prioritize based on primary indicators:
    //    - If pyproject.toml exists and has Python-specific sections, prefer Python
    //    - If package.json has TypeScript deps and .ts files exist, prefer TypeScript  
    //    - If Cargo.toml exists as primary config, prefer Rust
    
    const validResults = [
      { result: tsResult, language: 'typescript' as ProjectLanguage },
      { result: rustResult, language: 'rust' as ProjectLanguage },
      { result: pythonResult, language: 'python' as ProjectLanguage }
    ].filter(r => r.result.isValidProject);
    
    if (validResults.length === 0) {
      return {
        language: null,
        isValidProject: false,
        hasConfigFile: false,
        commands: null,
        error: 'No supported project type detected (TypeScript, Rust, or Python)'
      };
    }
    
    if (validResults.length === 1) {
      const chosen = validResults[0]!; // Safe because we checked length
      return {
        language: chosen.language,
        isValidProject: true,
        hasConfigFile: getHasConfigFile(chosen.result),
        commands: chosen.result.commands,
        error: chosen.result.error
      };
    }
    
    // Multiple valid projects detected - use intelligent priority
    const primaryLanguage = await determinePrimaryLanguage(projectPath, validResults);
    const chosen = validResults.find(r => r.language === primaryLanguage);
    
    if (!chosen) {
      // Fallback to first valid result if something went wrong
      const fallback = validResults[0]!; // Safe because we checked length > 0
      return {
        language: fallback.language,
        isValidProject: true,
        hasConfigFile: getHasConfigFile(fallback.result),
        commands: fallback.result.commands,
        error: fallback.result.error
      };
    }
    
    return {
      language: chosen.language,
      isValidProject: true,
      hasConfigFile: getHasConfigFile(chosen.result),
      commands: chosen.result.commands,
      error: chosen.result.error
    };

  } catch (error) {
    return {
      language: null,
      isValidProject: false,
      hasConfigFile: false,
      commands: null,
      error: 'Failed to detect project: ' + (error as Error).message
    };
  }
}

function getHasConfigFile(result: TypeScriptDetectionResult | RustDetectionResult | PythonDetectionResult): boolean {
  if ('hasPackageJson' in result) {
    return result.hasPackageJson;
  }
  if ('hasCargoToml' in result) {
    return result.hasCargoToml;
  }
  if ('hasConfigFile' in result) {
    return result.hasConfigFile;
  }
  return false;
}

async function determinePrimaryLanguage(
  projectPath: string, 
  validResults: Array<{ result: any; language: ProjectLanguage }>
): Promise<ProjectLanguage> {
  try {
    // Check for Python-specific indicators
    if (validResults.some(r => r.language === 'python')) {
      const pyprojectPath = path.join(projectPath, 'pyproject.toml');
      try {
        const pyprojectContent = await import('fs').then(fs => fs.promises.readFile(pyprojectPath, 'utf-8'));
        // If pyproject.toml contains Python-specific build system, prioritize Python
        if (pyprojectContent.includes('[tool.') || pyprojectContent.includes('python') || 
            pyprojectContent.includes('pytest') || pyprojectContent.includes('setuptools')) {
          return 'python';
        }
      } catch {
        // pyproject.toml doesn't exist or can't be read
      }
      
      // Check for Python test directories
      try {
        const entries = await import('fs').then(fs => fs.promises.readdir(projectPath));
        if (entries.some(entry => entry.includes('py') && entry !== 'pyproject.toml')) {
          return 'python';
        }
      } catch {
        // Can't read directory
      }
    }
    
    // Check for TypeScript-specific indicators  
    if (validResults.some(r => r.language === 'typescript')) {
      try {
        const packageJsonPath = path.join(projectPath, 'package.json');
        const packageContent = await import('fs').then(fs => fs.promises.readFile(packageJsonPath, 'utf-8'));
        const pkg = JSON.parse(packageContent);
        
        // If package.json is the primary config (has scripts, dependencies)
        if (pkg.scripts || pkg.dependencies || pkg.devDependencies) {
          return 'typescript';
        }
      } catch {
        // package.json doesn't exist or can't be read
      }
    }
    
    // Default to first valid result
    return validResults[0]?.language || 'typescript';
    
  } catch {
    return validResults[0]?.language || 'typescript';
  }
}

interface TypeScriptDetectionResult {
  isValidProject: boolean;
  hasPackageJson: boolean;
  commands: PackageJsonCommands | null;
  error?: string;
}

/**
 * Detects if a directory contains a TypeScript project with package.json
 * and extracts the necessary commands
 */
async function detectTypeScriptProject(projectPath: string): Promise<TypeScriptDetectionResult> {
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');
    
    // Check if package.json exists
    try {
      await fs.access(packageJsonPath);
    } catch (error) {
      return {
        isValidProject: false,
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
        isValidProject: false,
        hasPackageJson: true,
        commands: null,
        error: 'Failed to parse package.json: ' + (error as Error).message
      };
    }

    // Check if it's a TypeScript project
    const isTypeScriptProject = await checkIsTypeScriptProject(projectPath, packageJson);
    
    if (!isTypeScriptProject) {
      return {
        isValidProject: false,
        hasPackageJson: true,
        commands: null,
        error: 'Project is not detected as a TypeScript project'
      };
    }

    // Extract commands from scripts
    const scripts = packageJson.scripts || {};
    const commands = extractTypeScriptCommands(scripts);

    if (!commands) {
      return {
        isValidProject: true,
        hasPackageJson: true,
        commands: null,
        error: 'Required scripts (install/build/test) not found in package.json'
      };
    }

    return {
      isValidProject: true,
      hasPackageJson: true,
      commands,
      error: undefined
    };

  } catch (error) {
    return {
      isValidProject: false,
      hasPackageJson: false,
      commands: null,
      error: 'Failed to detect project: ' + (error as Error).message
    };
  }
}

interface RustDetectionResult {
  isValidProject: boolean;
  hasCargoToml: boolean;
  commands: CargoCommands | null;
  error?: string;
}

/**
 * Detects if a directory contains a Rust project with Cargo.toml
 */
async function detectRustProject(projectPath: string): Promise<RustDetectionResult> {
  try {
    const cargoTomlPath = path.join(projectPath, 'Cargo.toml');
    
    // Check if Cargo.toml exists
    try {
      await fs.access(cargoTomlPath);
    } catch (error) {
      return {
        isValidProject: false,
        hasCargoToml: false,
        commands: null,
        error: 'No Cargo.toml found in the project directory'
      };
    }

    // Read and check Cargo.toml
    try {
      const cargoTomlContent = await fs.readFile(cargoTomlPath, 'utf-8');
      // Basic validation - check if it contains [package] section
      if (!cargoTomlContent.includes('[package]')) {
        return {
          isValidProject: false,
          hasCargoToml: true,
          commands: null,
          error: 'Invalid Cargo.toml format'
        };
      }
    } catch (error) {
      return {
        isValidProject: false,
        hasCargoToml: true,
        commands: null,
        error: 'Failed to read Cargo.toml: ' + (error as Error).message
      };
    }

    // Check for src directory or main.rs/lib.rs
    const srcDir = path.join(projectPath, 'src');
    const mainRs = path.join(srcDir, 'main.rs');
    const libRs = path.join(srcDir, 'lib.rs');
    
    try {
      await fs.access(srcDir);
      // Check if either main.rs or lib.rs exists
      let hasEntryPoint = false;
      try {
        await fs.access(mainRs);
        hasEntryPoint = true;
      } catch {
        try {
          await fs.access(libRs);
          hasEntryPoint = true;
        } catch {
          // Neither found
        }
      }
      
      if (!hasEntryPoint) {
        return {
          isValidProject: false,
          hasCargoToml: true,
          commands: null,
          error: 'No main.rs or lib.rs found in src directory'
        };
      }
    } catch {
      return {
        isValidProject: false,
        hasCargoToml: true,
        commands: null,
        error: 'No src directory found'
      };
    }

    // Generate Rust commands
    const commands: CargoCommands = {
      installCommand: 'cargo build', // Rust doesn't have separate install, build handles dependencies
      buildCommand: 'cargo build --release',
      testCommand: 'cargo test'
    };

    return {
      isValidProject: true,
      hasCargoToml: true,
      commands,
      error: undefined
    };

  } catch (error) {
    return {
      isValidProject: false,
      hasCargoToml: false,
      commands: null,
      error: 'Failed to detect Rust project: ' + (error as Error).message
    };
  }
}

interface PythonDetectionResult {
  isValidProject: boolean;
  hasConfigFile: boolean;
  commands: PythonCommands | null;
  error?: string;
}

/**
 * Detects if a directory contains a Python project
 */
async function detectPythonProject(projectPath: string): Promise<PythonDetectionResult> {
  try {
    // Check for various Python project indicators
    const pyprojectPath = path.join(projectPath, 'pyproject.toml');
    const requirementsPath = path.join(projectPath, 'requirements.txt');
    const setupPyPath = path.join(projectPath, 'setup.py');
    const pipfilePath = path.join(projectPath, 'Pipfile');
    const poetryLockPath = path.join(projectPath, 'poetry.lock');
    const uvLockPath = path.join(projectPath, 'uv.lock');
    const pdmLockPath = path.join(projectPath, 'pdm.lock');
    
    let hasConfigFile = false;
    let configType = '';
    let toolType: 'poetry' | 'uv' | 'pdm' | 'pipenv' | 'pip' | 'unknown' = 'unknown';
    
    // Check for lock files first (highest priority - they indicate the actual tool being used)
    try {
      await fs.access(poetryLockPath);
      hasConfigFile = true;
      configType = 'poetry.lock';
      toolType = 'poetry';
    } catch {
      try {
        await fs.access(uvLockPath);
        hasConfigFile = true;
        configType = 'uv.lock';
        toolType = 'uv';
      } catch {
        try {
          await fs.access(pdmLockPath);
          hasConfigFile = true;
          configType = 'pdm.lock';
          toolType = 'pdm';
        } catch {
          // Check for pyproject.toml and parse it to determine tool
          try {
            await fs.access(pyprojectPath);
            hasConfigFile = true;
            configType = 'pyproject.toml';
            
            // Read pyproject.toml to detect tool
            const pyprojectContent = await fs.readFile(pyprojectPath, 'utf-8');
            
            if (pyprojectContent.includes('[tool.poetry]')) {
              toolType = 'poetry';
            } else if (pyprojectContent.includes('[tool.uv]')) {
              toolType = 'uv';
            } else if (pyprojectContent.includes('[tool.pdm]')) {
              toolType = 'pdm';
            } else if (pyprojectContent.includes('[build-system]')) {
              // Generic pyproject.toml, use pip
              toolType = 'pip';
            }
          } catch {
            // Check for Pipfile
            try {
              await fs.access(pipfilePath);
              hasConfigFile = true;
              configType = 'Pipfile';
              toolType = 'pipenv';
            } catch {
              // Check for requirements.txt
              try {
                await fs.access(requirementsPath);
                hasConfigFile = true;
                configType = 'requirements.txt';
                toolType = 'pip';
              } catch {
                // Check for setup.py
                try {
                  await fs.access(setupPyPath);
                  hasConfigFile = true;
                  configType = 'setup.py';
                  toolType = 'pip';
                } catch {
                  // No config file found
                }
              }
            }
          }
        }
      }
    }

    // Check for Python files
    const entries = await fs.readdir(projectPath);
    const hasPythonFiles = entries.some(entry => 
      entry.endsWith('.py') || entry === 'tests' || entry === 'test'
    );

    if (!hasConfigFile && !hasPythonFiles) {
      return {
        isValidProject: false,
        hasConfigFile: false,
        commands: null,
        error: 'No Python project indicators found (no .py files, pyproject.toml, requirements.txt, setup.py, or Pipfile)'
      };
    }

    // Generate Python commands based on detected tool
    let commands: PythonCommands;
    
    switch (toolType) {
      case 'poetry':
        commands = {
          installCommand: 'poetry install',
          buildCommand: 'poetry build',
          testCommand: 'poetry run pytest'
        };
        break;
      
      case 'uv':
        commands = {
          installCommand: 'uv sync',
          buildCommand: 'uv build',
          testCommand: 'uv run pytest'
        };
        break;
      
      case 'pdm':
        commands = {
          installCommand: 'pdm install',
          buildCommand: 'pdm build',
          testCommand: 'pdm run pytest'
        };
        break;
      
      case 'pipenv':
        commands = {
          installCommand: 'pipenv install --dev',
          buildCommand: 'echo "No build command needed for Python"',
          testCommand: 'pipenv run pytest'
        };
        break;
      
      case 'pip':
        if (configType === 'pyproject.toml') {
          commands = {
            installCommand: 'python3 -m venv venv && venv/bin/pip install --upgrade pip && venv/bin/pip install pytest && venv/bin/pip install -e .',
            buildCommand: 'venv/bin/python -m build',
            testCommand: 'venv/bin/python -m pytest'
          };
        } else if (configType === 'requirements.txt') {
          commands = {
            installCommand: 'python3 -m venv venv && venv/bin/pip install --upgrade pip && venv/bin/pip install pytest && venv/bin/pip install -r requirements.txt',
            buildCommand: 'echo "No build command needed for Python"',
            testCommand: 'venv/bin/python -m pytest'
          };
        } else if (configType === 'setup.py') {
          commands = {
            installCommand: 'python3 -m venv venv && venv/bin/pip install --upgrade pip && venv/bin/pip install pytest && venv/bin/pip install -e .',
            buildCommand: 'venv/bin/python setup.py build',
            testCommand: 'venv/bin/python -m pytest'
          };
        } else {
          commands = {
            installCommand: 'pip3 install --user pytest',
            buildCommand: 'echo "No build command needed for Python"',
            testCommand: 'python3 -m pytest'
          };
        }
        break;
      
      default:
        // Fallback for when we have Python files but no specific config
        commands = {
          installCommand: 'pip3 install --user pytest',
          buildCommand: 'echo "No build command needed for Python"',
          testCommand: 'python3 -m pytest'
        };
    }

    return {
      isValidProject: true,
      hasConfigFile,
      commands,
      error: undefined
    };

  } catch (error) {
    return {
      isValidProject: false,
      hasConfigFile: false,
      commands: null,
      error: 'Failed to detect Python project: ' + (error as Error).message
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
 * Extracts install, build, and test commands from package.json scripts for TypeScript projects
 * Returns script names (not full commands) - the package manager will be prepended later
 */
function extractTypeScriptCommands(scripts: Record<string, string>): PackageJsonCommands | null {
  // Determine install command - this will be replaced by package manager detection
  let installCommand = 'npm install'; // Placeholder, will be updated

  // Determine build script name
  let buildScriptName: string | null = null;
  const buildCandidates = ['build', 'compile', 'tsc', 'webpack'];
  for (const candidate of buildCandidates) {
    if (scripts[candidate]) {
      buildScriptName = candidate;
      break;
    }
  }

  // If no build script found, try common TypeScript build patterns
  if (!buildScriptName) {
    if (scripts.prepare && scripts.prepare.includes('tsc')) {
      buildScriptName = 'prepare';
    } else if (scripts.prepublish && scripts.prepublish.includes('tsc')) {
      buildScriptName = 'prepublish';
    }
  }

  // Determine test script name
  let testScriptName: string | null = null;
  const testCandidates = ['test', 'test:unit', 'test:all', 'jest', 'mocha', 'vitest'];
  for (const candidate of testCandidates) {
    if (scripts[candidate]) {
      testScriptName = candidate;
      break;
    }
  }

  // Check if we found required scripts
  if (!testScriptName) {
    return null;
  }

  // Return script names that will be used with package manager
  // buildCommand is optional for some projects
  return {
    installCommand,
    buildCommand: buildScriptName || 'echo "No build script"',
    testCommand: testScriptName
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
 * Converts script names to full commands with the appropriate package manager
 */
export function updateCommandsForPackageManager(
  commands: PackageJsonCommands, 
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun'
): PackageJsonCommands {
  // Install command is straightforward
  const installCommand = packageManager === 'npm' ? 'npm install' :
                        packageManager === 'yarn' ? 'yarn install' :
                        packageManager === 'pnpm' ? 'pnpm install' :
                        'bun install';

  // Build command: prepend package manager's run command
  // Exception: if buildCommand starts with 'echo', leave it as-is (no build needed)
  let buildCommand = commands.buildCommand;
  if (buildCommand && !buildCommand.startsWith('echo ')) {
    // Different package managers have different syntax
    if (packageManager === 'npm' || packageManager === 'pnpm') {
      buildCommand = `${packageManager} run ${buildCommand}`;
    } else if (packageManager === 'yarn') {
      buildCommand = `yarn ${buildCommand}`; // yarn doesn't need 'run'
    } else if (packageManager === 'bun') {
      buildCommand = `bun run ${buildCommand}`;
    }
  }

  // Test command: prepend package manager's test/run command
  let testCommand = commands.testCommand;
  if (testCommand) {
    // Special handling for 'test' script - most package managers have a shortcut
    if (testCommand === 'test') {
      if (packageManager === 'npm') {
        testCommand = 'npm test';
      } else if (packageManager === 'yarn') {
        testCommand = 'yarn test';
      } else if (packageManager === 'pnpm') {
        testCommand = 'pnpm test';
      } else if (packageManager === 'bun') {
        testCommand = 'bun test';
      }
    } else {
      // For other test scripts like 'test:unit', use run command
      if (packageManager === 'npm' || packageManager === 'pnpm') {
        testCommand = `${packageManager} run ${testCommand}`;
      } else if (packageManager === 'yarn') {
        testCommand = `yarn ${testCommand}`;
      } else if (packageManager === 'bun') {
        testCommand = `bun run ${testCommand}`;
      }
    }
  }

  return {
    installCommand,
    buildCommand,
    testCommand
  };
}
