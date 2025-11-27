use dotenvy::dotenv;
use intent_verification::verify_intent;
use std::env;

#[tokio::test]
async fn test_verify_typescript_sample_repo() {
    // Load .env file
    dotenv().ok();

    // Get API key from environment variable
    let api_key = match env::var("OPENAI_API_KEY") {
        Ok(key) => {
            if !key.starts_with("sk-") {
                println!("Skipping test - no valid API key available");
                return;
            }
            key
        }
        Err(_) => {
            println!("Skipping test - OPENAI_API_KEY not set");
            return;
        }
    };

    let user_intent = "I want to ensure the tests/index.test.ts works correctly";

    let solution_repo_url = "https://github.com/VAR-META-Tech/intent-verification-sample-ts";
    let solution_commit1 = "2fd75de38547b530ea18cbe86d47c5f7e9817265";
    let solution_commit2 = "76142ad34176aafdff119306c72ef0b700009905";
    let test_repo_url = "https://github.com/VAR-META-Tech/intent-verification-sample-ts";
    let test_commit = "2fd75de38547b530ea18cbe86d47c5f7e9817265";

    match verify_intent(
        test_repo_url,
        test_commit,
        solution_repo_url,
        solution_commit1,
        solution_commit2,
        user_intent,
        &api_key,
        None, // model
        None, // base_url
    )
    .await
    {
        Ok(result) => {
            println!("\n✅ Intent Verification Result:");
            println!("  Intent Fulfilled: {}", result.is_intent_fulfilled);
            println!("  Confidence: {:.2}", result.confidence);
            println!("  Explanation: {}", result.explanation);
            println!("\n  Overall Assessment:");
            println!("  {}", result.overall_assessment);

            println!("\n  📁 Files Analyzed ({}):", result.files_analyzed.len());
            for file_analysis in &result.files_analyzed {
                println!(
                    "    - {} [{:?}]: {}",
                    file_analysis.file_path,
                    file_analysis.change_type,
                    if file_analysis.supports_intent {
                        "✅ SUPPORTS"
                    } else {
                        "❌ DOES NOT SUPPORT"
                    }
                );
                println!("      Reasoning: {}", file_analysis.reasoning);
                if !file_analysis.relevant_changes.is_empty() {
                    println!("      Relevant Changes:");
                    for change in &file_analysis.relevant_changes {
                        println!("        • {}", change);
                    }
                }
            }

            // Assertions
            assert!(
                result.confidence >= 0.0 && result.confidence <= 1.0,
                "Confidence should be between 0 and 1"
            );
            assert!(!result.explanation.is_empty(), "Should have an explanation");
            assert!(
                !result.overall_assessment.is_empty(),
                "Should have an overall assessment"
            );
            assert!(
                !result.files_analyzed.is_empty(),
                "Should have analyzed at least one file"
            );
        }
        Err(e) => {
            panic!("Failed to verify TypeScript sample repository: {}", e);
        }
    }

    println!("\n✅ TypeScript Sample Repository test completed successfully");
}

#[tokio::test]
async fn test_verify_rust_sample_repo() {
    // Load .env file
    dotenv().ok();

    // Get API key from environment variable
    let api_key = match env::var("OPENAI_API_KEY") {
        Ok(key) => {
            if !key.starts_with("sk-") {
                println!("Skipping test - no valid API key available");
                return;
            }
            key
        }
        Err(_) => {
            println!("Skipping test - OPENAI_API_KEY not set");
            return;
        }
    };

    let user_intent = "I want to ensure the tests/sum_tests.rs works correctly";

    let solution_repo_url = "https://github.com/VAR-META-Tech/intent-verification-sample-rs";
    let solution_commit1 = "818d444d66d63240aa052a390e456eeae8f0638d";
    let solution_commit2 = "f5438f954d4d99fd8e6fecc822c046e320954d2f";
    let test_repo_url = "https://github.com/VAR-META-Tech/intent-verification-sample-rs";
    let test_commit = "818d444d66d63240aa052a390e456eeae8f0638d";

    match verify_intent(
        test_repo_url,
        test_commit,
        solution_repo_url,
        solution_commit1,
        solution_commit2,
        user_intent,
        &api_key,
        None, // model
        None, // base_url
    )
    .await
    {
        Ok(result) => {
            println!("\n✅ Intent Verification Result:");
            println!("  Intent Fulfilled: {}", result.is_intent_fulfilled);
            println!("  Confidence: {:.2}", result.confidence);
            println!("  Explanation: {}", result.explanation);
            println!("\n  Overall Assessment:");
            println!("  {}", result.overall_assessment);

            println!("\n  📁 Files Analyzed ({}):", result.files_analyzed.len());
            for file_analysis in &result.files_analyzed {
                println!(
                    "    - {} [{:?}]: {}",
                    file_analysis.file_path,
                    file_analysis.change_type,
                    if file_analysis.supports_intent {
                        "✅ SUPPORTS"
                    } else {
                        "❌ DOES NOT SUPPORT"
                    }
                );
                println!("      Reasoning: {}", file_analysis.reasoning);
                if !file_analysis.relevant_changes.is_empty() {
                    println!("      Relevant Changes:");
                    for change in &file_analysis.relevant_changes {
                        println!("        • {}", change);
                    }
                }
            }

            // Assertions
            assert!(
                result.confidence >= 0.0 && result.confidence <= 1.0,
                "Confidence should be between 0 and 1"
            );
            assert!(!result.explanation.is_empty(), "Should have an explanation");
            assert!(
                !result.overall_assessment.is_empty(),
                "Should have an overall assessment"
            );
            assert!(
                !result.files_analyzed.is_empty(),
                "Should have analyzed at least one file"
            );
        }
        Err(e) => {
            panic!("Failed to verify Rust sample repository: {}", e);
        }
    }

    println!("\n✅ Rust Sample Repository test completed successfully");
}

#[tokio::test]
async fn test_verify_py_sample_repo() {
    // Load .env file
    dotenv().ok();

    // Get API key from environment variable
    let api_key = match env::var("OPENAI_API_KEY") {
        Ok(key) => {
            if !key.starts_with("sk-") {
                println!("Skipping test - no valid API key available");
                return;
            }
            key
        }
        Err(_) => {
            println!("Skipping test - OPENAI_API_KEY not set");
            return;
        }
    };

    let user_intent = "I want to ensure the tests/test_main.py works correctly";

    let solution_repo_url = "https://github.com/VAR-META-Tech/intent-verification-sample-py";
    let solution_commit1 = "b9ce728166ecc8a376986d624531af90aae3167b";
    let solution_commit2 = "8b85053596ae139d7eb6437ee74a14cc521bfe0a";
    let test_repo_url = "https://github.com/VAR-META-Tech/intent-verification-sample-py";
    let test_commit = "b9ce728166ecc8a376986d624531af90aae3167b";

    match verify_intent(
        test_repo_url,
        test_commit,
        solution_repo_url,
        solution_commit1,
        solution_commit2,
        user_intent,
        &api_key,
        None, // model
        None, // base_url
    )
    .await
    {
        Ok(result) => {
            println!("\n✅ Intent Verification Result:");
            println!("  Intent Fulfilled: {}", result.is_intent_fulfilled);
            println!("  Confidence: {:.2}", result.confidence);
            println!("  Explanation: {}", result.explanation);
            println!("\n  Overall Assessment:");
            println!("  {}", result.overall_assessment);

            println!("\n  📁 Files Analyzed ({}):", result.files_analyzed.len());
            for file_analysis in &result.files_analyzed {
                println!(
                    "    - {} [{:?}]: {}",
                    file_analysis.file_path,
                    file_analysis.change_type,
                    if file_analysis.supports_intent {
                        "✅ SUPPORTS"
                    } else {
                        "❌ DOES NOT SUPPORT"
                    }
                );
                println!("      Reasoning: {}", file_analysis.reasoning);
                if !file_analysis.relevant_changes.is_empty() {
                    println!("      Relevant Changes:");
                    for change in &file_analysis.relevant_changes {
                        println!("        • {}", change);
                    }
                }
            }

            // Assertions
            assert!(
                result.confidence >= 0.0 && result.confidence <= 1.0,
                "Confidence should be between 0 and 1"
            );
            assert!(!result.explanation.is_empty(), "Should have an explanation");
            assert!(
                !result.overall_assessment.is_empty(),
                "Should have an overall assessment"
            );
            assert!(
                !result.files_analyzed.is_empty(),
                "Should have analyzed at least one file"
            );
        }
        Err(e) => {
            panic!("Failed to verify Python sample repository: {}", e);
        }
    }

    println!("\n✅ Python Sample Repository test completed successfully");
}
