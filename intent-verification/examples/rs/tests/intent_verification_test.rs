use dotenvy::dotenv;
use intent_verification::verify_intent;
use std::env;

#[tokio::test]
async fn test_intent_verification() {
    // Load .env file
    dotenv().ok();

    // Get configuration from environment variables
    let api_key = env::var("OPENAI_API_KEY").expect("OPENAI_API_KEY must be set");
    let user_intent = env::var("USER_INTENT")
        .unwrap_or_else(|_| "I want to ensure the tests/sum_tests.rs works correctly".to_string());
    let test_repo_url = env::var("TEST_REPO_URL").unwrap_or_else(|_| {
        "https://github.com/VAR-META-Tech/intent-verification-sample-rs".to_string()
    });
    let test_commit = env::var("TEST_COMMIT")
        .unwrap_or_else(|_| "818d444d66d63240aa052a390e456eeae8f0638d".to_string());
    let solution_repo_url = env::var("SOLUTION_REPO_URL").unwrap_or_else(|_| {
        "https://github.com/VAR-META-Tech/intent-verification-sample-rs".to_string()
    });
    let solution_commit1 = env::var("SOLUTION_COMMIT1")
        .unwrap_or_else(|_| "818d444d66d63240aa052a390e456eeae8f0638d".to_string());
    let solution_commit2 = env::var("SOLUTION_COMMIT2")
        .unwrap_or_else(|_| "f5438f954d4d99fd8e6fecc822c046e320954d2f".to_string());

    match verify_intent(
        &test_repo_url,
        &test_commit,
        &solution_repo_url,
        &solution_commit1,
        &solution_commit2,
        &user_intent,
        &api_key,
        None,
        None,
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
            assert!(result.is_intent_fulfilled, "Intent should be fulfilled");
        }
        Err(e) => {
            panic!("Failed to verify Rust sample repository: {}", e);
        }
    }
}
