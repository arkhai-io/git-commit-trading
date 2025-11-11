import { describe, test, expect, beforeAll } from "bun:test";
import { updateCommandsForPackageManager } from "../src/test-execution/projectDetection";
import type { PackageJsonCommands } from "../src/test-execution/projectDetection";

describe("Package Manager Command Generation", () => {
    const baseCommands: PackageJsonCommands = {
        installCommand: 'npm install', // This will be replaced
        buildCommand: 'build',
        testCommand: 'test'
    };

    describe("npm", () => {
        test("should generate correct npm commands", () => {
            const commands = updateCommandsForPackageManager(baseCommands, 'npm');
            
            expect(commands.installCommand).toBe('npm install');
            expect(commands.buildCommand).toBe('npm run build');
            expect(commands.testCommand).toBe('npm test'); // Shortcut for test
        });

        test("should handle custom test script names with npm", () => {
            const customCommands: PackageJsonCommands = {
                installCommand: 'npm install',
                buildCommand: 'build',
                testCommand: 'test:unit'
            };
            const commands = updateCommandsForPackageManager(customCommands, 'npm');
            
            expect(commands.testCommand).toBe('npm run test:unit');
        });

        test("should preserve echo commands", () => {
            const noBuildCommands: PackageJsonCommands = {
                installCommand: 'npm install',
                buildCommand: 'echo "No build needed"',
                testCommand: 'test'
            };
            const commands = updateCommandsForPackageManager(noBuildCommands, 'npm');
            
            expect(commands.buildCommand).toBe('echo "No build needed"');
        });
    });

    describe("yarn", () => {
        test("should generate correct yarn commands", () => {
            const commands = updateCommandsForPackageManager(baseCommands, 'yarn');
            
            expect(commands.installCommand).toBe('yarn install');
            expect(commands.buildCommand).toBe('yarn build'); // yarn doesn't need 'run'
            expect(commands.testCommand).toBe('yarn test');
        });

        test("should handle custom test script names with yarn", () => {
            const customCommands: PackageJsonCommands = {
                installCommand: 'yarn install',
                buildCommand: 'build',
                testCommand: 'test:e2e'
            };
            const commands = updateCommandsForPackageManager(customCommands, 'yarn');
            
            expect(commands.testCommand).toBe('yarn test:e2e');
        });
    });

    describe("pnpm", () => {
        test("should generate correct pnpm commands", () => {
            const commands = updateCommandsForPackageManager(baseCommands, 'pnpm');
            
            expect(commands.installCommand).toBe('pnpm install');
            expect(commands.buildCommand).toBe('pnpm run build');
            expect(commands.testCommand).toBe('pnpm test');
        });

        test("should handle custom test script names with pnpm", () => {
            const customCommands: PackageJsonCommands = {
                installCommand: 'pnpm install',
                buildCommand: 'compile',
                testCommand: 'test:integration'
            };
            const commands = updateCommandsForPackageManager(customCommands, 'pnpm');
            
            expect(commands.buildCommand).toBe('pnpm run compile');
            expect(commands.testCommand).toBe('pnpm run test:integration');
        });
    });

    describe("bun", () => {
        test("should generate correct bun commands", () => {
            const commands = updateCommandsForPackageManager(baseCommands, 'bun');
            
            expect(commands.installCommand).toBe('bun install');
            expect(commands.buildCommand).toBe('bun run build');
            expect(commands.testCommand).toBe('bun test');
        });

        test("should handle custom test script names with bun", () => {
            const customCommands: PackageJsonCommands = {
                installCommand: 'bun install',
                buildCommand: 'build',
                testCommand: 'test:watch'
            };
            const commands = updateCommandsForPackageManager(customCommands, 'bun');
            
            expect(commands.testCommand).toBe('bun run test:watch');
        });
    });

    describe("Edge cases", () => {
        test("should handle build scripts with special names", () => {
            const commands: PackageJsonCommands = {
                installCommand: 'npm install',
                buildCommand: 'compile',
                testCommand: 'test'
            };
            
            const npmResult = updateCommandsForPackageManager(commands, 'npm');
            expect(npmResult.buildCommand).toBe('npm run compile');
            
            const yarnResult = updateCommandsForPackageManager(commands, 'yarn');
            expect(yarnResult.buildCommand).toBe('yarn compile');
        });

        test("should handle complex test script names", () => {
            const commands: PackageJsonCommands = {
                installCommand: 'npm install',
                buildCommand: 'build',
                testCommand: 'test:unit:watch'
            };
            
            const bunResult = updateCommandsForPackageManager(commands, 'bun');
            expect(bunResult.testCommand).toBe('bun run test:unit:watch');
        });
    });

    describe("Real-world scenarios", () => {
        test("Alice wants tests run with bun, but Bob's repo uses npm lock", () => {
            // This simulates when escrow specifies bun but project has package-lock.json
            // The system should use the detected package manager (npm in this case)
            // unless explicitly overridden
            const commands: PackageJsonCommands = {
                installCommand: 'npm install',
                buildCommand: 'build',
                testCommand: 'test'
            };
            
            // If Alice's escrow specifies bun, the system will use bun
            const bunResult = updateCommandsForPackageManager(commands, 'bun');
            expect(bunResult.testCommand).toBe('bun test');
            
            // The actual package manager detection happens before this function
            // So if Bob has package-lock.json, detectPackageManager will return 'npm'
            const npmResult = updateCommandsForPackageManager(commands, 'npm');
            expect(npmResult.testCommand).toBe('npm test');
        });

        test("Project with vitest script", () => {
            const commands: PackageJsonCommands = {
                installCommand: 'npm install',
                buildCommand: 'build',
                testCommand: 'vitest'
            };
            
            const result = updateCommandsForPackageManager(commands, 'bun');
            expect(result.testCommand).toBe('bun run vitest');
        });

        test("Project with jest script", () => {
            const commands: PackageJsonCommands = {
                installCommand: 'npm install',
                buildCommand: 'build',
                testCommand: 'jest'
            };
            
            const result = updateCommandsForPackageManager(commands, 'npm');
            expect(result.testCommand).toBe('npm run jest');
        });
    });
});
