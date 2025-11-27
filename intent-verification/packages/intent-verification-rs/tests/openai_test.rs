use dotenvy::dotenv;
use intent_verification::ask_openai_internal;
use std::env;

#[tokio::test]
async fn test_ask_openai_internal() {
    // Load `.env` file
    dotenv().ok();

    println!("Testing Intent Verification Library");
    println!("===================================");

    // Get API key from environment variable or use a placeholder
    let api_key = env::var("OPENAI_API_KEY").unwrap_or_else(|_| {
        println!("Warning: OPENAI_API_KEY environment variable not set.");
        println!("Using placeholder API key for testing (this will fail actual API calls).");
        "sk-placeholder-api-key-for-testing".to_string()
    });

    println!(
        "API Key: {} (first 10 chars)",
        &api_key[..std::cmp::min(10, api_key.len())]
    );

    // Simple test with one prompt
    let prompt = "Hello, how are you?";
    println!("\nTesting with prompt: {}", prompt);

    // Call the internal async function directly
    match ask_openai_internal(prompt, &api_key, None, None).await {
        Ok(result) => {
            println!("Result: {}", result);
            assert!(!result.is_empty(), "Result should not be empty");
            assert!(result.len() > 10, "Result should be a meaningful response");
        }
        Err(e) => {
            println!("Error: {}", e);
            // If we get an API key error, that's expected with placeholder key
            if api_key.starts_with("sk-placeholder") {
                println!("Expected error with placeholder API key");
            } else {
                panic!("Unexpected error with real API key: {}", e);
            }
        }
    }

    println!("\nTesting completed!");
}
