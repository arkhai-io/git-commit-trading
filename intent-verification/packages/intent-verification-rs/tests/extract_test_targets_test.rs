use dotenvy::dotenv;
use intent_verification::extract_test_targets_with_ai;
use std::env;

#[tokio::test]
async fn test_extract_test_targets_simple_prompt() {
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

    let prompt = "I want to test the calculate_sum in math.rs and the process_data in utils.rs";

    match extract_test_targets_with_ai(prompt, &api_key, None, None).await {
        Ok(targets) => {
            println!("✅ Extracted test targets:");
            println!("  Functions: {:?}", targets.functions);
            println!("  Files: {:?}", targets.files);

            // Verify we got some results
            assert!(
                !targets.functions.is_empty() || !targets.files.is_empty(),
                "Should extract at least some functions or files"
            );

            // Check if expected items are present (case-insensitive)
            let functions_lower: Vec<String> =
                targets.functions.iter().map(|s| s.to_lowercase()).collect();
            let files_lower: Vec<String> = targets.files.iter().map(|s| s.to_lowercase()).collect();

            let has_calculate_sum = functions_lower
                .iter()
                .any(|f| f.contains("calculate_sum") || f.contains("sum"));
            let has_process_data = functions_lower
                .iter()
                .any(|f| f.contains("process_data") || f.contains("data"));
            let has_math_rs = files_lower.iter().any(|f| f.contains("math"));
            let has_utils_rs = files_lower.iter().any(|f| f.contains("utils"));

            println!("  Found calculate_sum: {}", has_calculate_sum);
            println!("  Found process_data: {}", has_process_data);
            println!("  Found math.rs: {}", has_math_rs);
            println!("  Found utils.rs: {}", has_utils_rs);
        }
        Err(e) => {
            panic!("Failed to extract test targets: {}", e);
        }
    }
}

#[tokio::test]
async fn test_extract_test_targets_file_paths() {
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

    let prompt =
        "Test src/main.rs, tests/integration_test.rs, and the helper module in src/helpers/mod.rs";

    match extract_test_targets_with_ai(prompt, &api_key, None, None).await {
        Ok(targets) => {
            println!("✅ Extracted test targets with file paths:");
            println!("  Functions: {:?}", targets.functions);
            println!("  Files: {:?}", targets.files);

            // Should extract file paths
            assert!(
                !targets.files.is_empty(),
                "Should extract file paths from prompt"
            );

            let files_lower: Vec<String> = targets.files.iter().map(|s| s.to_lowercase()).collect();

            println!("  File paths extracted: {}", targets.files.len());

            // Check for some expected files
            let has_main = files_lower.iter().any(|f| f.contains("main"));
            let has_test = files_lower.iter().any(|f| f.contains("test"));

            println!("  Found main.rs reference: {}", has_main);
            println!("  Found test file reference: {}", has_test);
        }
        Err(e) => {
            panic!("Failed to extract file paths: {}", e);
        }
    }
}
