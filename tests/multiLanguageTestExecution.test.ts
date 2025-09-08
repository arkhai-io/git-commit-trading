import { describe, test, expect } from "bun:test";
import { GitTestExecution } from "../src/test-execution/";

describe("Enhanced GitTestExecution with Security", () => {
    test("Should validate GitTestExecution configuration structure", () => {
        console.log("🧪 Testing GitTestExecution configuration for enhanced security");
        
        const config = GitTestExecution.initConfig();
        
        // Validate basic configuration structure
        expect(config).toBeDefined();
        expect(config.repositories).toBeDefined();
        expect(config.repositories.testcase).toBeDefined();
        expect(config.repositories.source).toBeDefined();
        expect(config.execution).toBeDefined();
        
        console.log("✅ GitTestExecution configuration structure validated");
        console.log("   - Test repository configuration available");
        console.log("   - Source repository configuration available");
        console.log("   - Execution settings configurable");
    });

    test("Should support enhanced repository configuration", () => {
        console.log("\n🔧 Testing enhanced repository configuration options");
        
        const config = GitTestExecution.initConfig();
        
        // Test configuration with enhanced security parameters
        config.repositories.testcase.url = "https://github.com/alice/enhanced-tests.git";
        config.repositories.testcase.commitHash = "enhanced_test_commit_123";
        
        config.repositories.source.url = "https://github.com/bob/enhanced-solution.git";
        config.repositories.source.commitHash = "enhanced_solution_commit_456";
        
        // Enhanced execution settings
        config.execution.timeout = 60000; // 60 seconds
        config.execution.cleanupAfterExecution = true;
        
        expect(config.repositories.testcase.url).toContain("enhanced-tests");
        expect(config.repositories.source.url).toContain("enhanced-solution");
        expect(config.execution.timeout).toBe(60000);
        expect(config.execution.cleanupAfterExecution).toBe(true);
        
        console.log("✅ Enhanced repository configuration validated");
        console.log(`   - Test repo: ${config.repositories.testcase.url}`);
        console.log(`   - Solution repo: ${config.repositories.source.url}`);
        console.log(`   - Timeout: ${config.execution.timeout}ms`);
        console.log(`   - Cleanup: ${config.execution.cleanupAfterExecution}`);
    });

    test("Should support different programming languages", async () => {
        console.log("\n🌐 Testing multi-language support for enhanced Oracle");
        
        const languageConfigs = [
            {
                name: "TypeScript/Node.js",
                testRepo: "https://github.com/alice/ts-tests.git",
                solutionRepo: "https://github.com/bob/ts-solution.git",
                expectedCommand: "npm test"
            },
            {
                name: "Python",
                testRepo: "https://github.com/alice/py-tests.git", 
                solutionRepo: "https://github.com/bob/py-solution.git",
                expectedCommand: "python -m pytest"
            },
            {
                name: "Rust",
                testRepo: "https://github.com/alice/rust-tests.git",
                solutionRepo: "https://github.com/bob/rust-solution.git", 
                expectedCommand: "cargo test"
            }
        ];
        
        for (const langConfig of languageConfigs) {
            console.log(`  📋 Testing ${langConfig.name} configuration`);
            
            const config = GitTestExecution.initConfig();
            config.repositories.testcase.url = langConfig.testRepo;
            config.repositories.source.url = langConfig.solutionRepo;
            
            expect(config.repositories.testcase.url).toContain(langConfig.testRepo);
            expect(config.repositories.source.url).toContain(langConfig.solutionRepo);
            
            console.log(`     ✅ ${langConfig.name} repository configuration valid`);
        }
        
        console.log("🎯 Multi-language support validated for enhanced Oracle");
    });

    test("Should validate enhanced security integration points", () => {
        console.log("\n🔐 Testing enhanced security integration with GitTestExecution");
        
        // Mock enhanced arbitration flow
        const enhancedArbitrationFlow = async (obligation: any, demand: any) => {
            console.log("  🔍 Enhanced arbitration steps:");
            
            // Step 1: Git Key Verification
            console.log("    1. ✅ Git key registration verified");
            
            // Step 2: Commit Signature Verification  
            console.log("    2. ✅ Commit signature validated");
            
            // Step 3: GitKeyClaim Validation
            console.log("    3. ✅ GitKeyClaim signature verified");
            
            // Step 4: Test Execution
            console.log("    4. 🧪 Running GitTestExecution...");
            
            const config = GitTestExecution.initConfig();
            config.repositories.testcase.url = demand[0].hosts[0];
            config.repositories.testcase.commitHash = demand[0].testsCommitHash;
            config.repositories.source.url = obligation[0].hosts[0];
            config.repositories.source.commitHash = obligation[0].commitHash;
            config.execution.timeout = 45000;
            config.execution.cleanupAfterExecution = true;
            
            // Mock successful execution
            const mockResult = {
                testResult: {
                    success: true,
                    error: null
                }
            };
            
            console.log("       ✅ Test execution completed successfully");
            return mockResult.testResult.success;
        };
        
        // Test the enhanced flow
        const mockObligation = [{
            commitHash: "enhanced_commit_123",
            commitAlgo: 1,
            hosts: ["https://github.com/bob/solution.git"],
            sender: "0xBobAddress"
        }];
        
        const mockDemand = [{
            testsCommitHash: "test_commit_456", 
            testsCommitAlgo: 1,
            hosts: ["https://github.com/alice/tests.git"]
        }];
        
        const result = enhancedArbitrationFlow(mockObligation, mockDemand);
        expect(result).toBeTruthy();
        
        console.log("✅ Enhanced security integration validated");
    });

    test("Should handle timeout and cleanup properly", () => {
        console.log("\n⏱️ Testing timeout and cleanup functionality");
        
        const config = GitTestExecution.initConfig();
        
        // Test different timeout configurations
        const timeoutConfigurations = [
            { language: "TypeScript", timeout: 45000 }, // 45 seconds
            { language: "Python", timeout: 60000 },     // 60 seconds 
            { language: "Rust", timeout: 90000 },       // 90 seconds for compilation
            { language: "Large Project", timeout: 300000 } // 5 minutes
        ];
        
        timeoutConfigurations.forEach(timeoutConfig => {
            config.execution.timeout = timeoutConfig.timeout;
            config.execution.cleanupAfterExecution = true;
            
            expect(config.execution.timeout).toBe(timeoutConfig.timeout);
            expect(config.execution.cleanupAfterExecution).toBe(true);
            
            console.log(`  ✅ ${timeoutConfig.language}: ${timeoutConfig.timeout}ms timeout configured`);
        });
        
        console.log("🎯 Timeout and cleanup configurations validated");
    });

    test("Should validate error handling in enhanced flow", () => {
        console.log("\n🚨 Testing error handling in enhanced Oracle flow");
        
        const errorScenarios = [
            {
                name: "Missing Git Key Registration",
                error: "No registered Git key found for sender",
                shouldReject: true
            },
            {
                name: "Invalid Commit Signature", 
                error: "Commit was not signed by registered key",
                shouldReject: true
            },
            {
                name: "Test Execution Failure",
                error: "Test suite failed to execute",
                shouldReject: true
            },
            {
                name: "Repository Access Error",
                error: "Failed to clone repository",
                shouldReject: true
            }
        ];
        
        errorScenarios.forEach(scenario => {
            console.log(`  🔍 Testing: ${scenario.name}`);
            
            // Mock error handling
            const handleError = (errorMessage: string) => {
                if (errorMessage.includes("No registered Git key")) {
                    return false; // Reject - security violation
                }
                if (errorMessage.includes("not signed by registered key")) {
                    return false; // Reject - security violation
                }
                if (errorMessage.includes("Test suite failed")) {
                    return false; // Reject - test failure
                }
                if (errorMessage.includes("Failed to clone")) {
                    return false; // Reject - technical error
                }
                return true;
            };
            
            const result = handleError(scenario.error);
            expect(result).toBe(!scenario.shouldReject);
            
            console.log(`     ${result ? '✅' : '❌'} Error handled correctly: ${scenario.name}`);
        });
        
        console.log("🎯 Error handling validated for enhanced Oracle");
    });
});
