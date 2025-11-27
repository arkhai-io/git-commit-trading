use dotenvy::dotenv;
use intent_verification::{free_str, verify_intent_c};
use std::env;
use std::ffi::{CStr, CString};

#[test]
fn test_verify_intent_c_rust() {
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

    // Convert strings to C strings
    let c_test_repo_url = CString::new(test_repo_url).unwrap();
    let c_test_commit = CString::new(test_commit).unwrap();
    let c_solution_repo_url = CString::new(solution_repo_url).unwrap();
    let c_solution_commit1 = CString::new(solution_commit1).unwrap();
    let c_solution_commit2 = CString::new(solution_commit2).unwrap();
    let c_user_intent = CString::new(user_intent).unwrap();
    let c_api_key = CString::new(api_key).unwrap();

    // Call the FFI function
    let result_ptr = verify_intent_c(
        c_test_repo_url.as_ptr(),
        c_test_commit.as_ptr(),
        c_solution_repo_url.as_ptr(),
        c_solution_commit1.as_ptr(),
        c_solution_commit2.as_ptr(),
        c_user_intent.as_ptr(),
        c_api_key.as_ptr(),
        std::ptr::null(), // model
        std::ptr::null(), // base_url
    );

    // Check that we got a non-null result
    assert!(!result_ptr.is_null(), "FFI function returned null");

    // Convert the result back to a Rust string
    let result_json = unsafe {
        let c_str = CStr::from_ptr(result_ptr);
        c_str
            .to_str()
            .expect("Failed to convert C string to Rust string")
    };

    println!("\n✅ FFI Result (JSON):");
    println!("{}", result_json);

    // Parse the JSON to verify structure
    let result: serde_json::Value =
        serde_json::from_str(result_json).expect("Failed to parse JSON result");

    // Verify the structure
    assert!(result.is_object(), "Result should be a JSON object");
    assert!(
        result.get("is_intent_fulfilled").is_some(),
        "Should have is_intent_fulfilled field"
    );
    assert!(
        result.get("confidence").is_some(),
        "Should have confidence field"
    );
    assert!(
        result.get("explanation").is_some(),
        "Should have explanation field"
    );
    assert!(
        result.get("overall_assessment").is_some(),
        "Should have overall_assessment field"
    );
    assert!(
        result.get("files_analyzed").is_some(),
        "Should have files_analyzed field"
    );

    // Verify confidence is a number between 0 and 1
    let confidence = result["confidence"]
        .as_f64()
        .expect("Confidence should be a number");
    assert!(
        confidence >= 0.0 && confidence <= 1.0,
        "Confidence should be between 0 and 1"
    );

    // Verify files_analyzed is an array
    assert!(
        result["files_analyzed"].is_array(),
        "files_analyzed should be an array"
    );
    assert!(
        !result["files_analyzed"].as_array().unwrap().is_empty(),
        "Should have analyzed at least one file"
    );

    // Free the allocated string
    free_str(result_ptr);

    println!("\n✅ FFI Rust test completed successfully");
}

#[test]
fn test_verify_intent_c_null_handling() {
    // Test that the function properly handles null parameters
    let valid_str = CString::new("test").unwrap();
    let api_key = match env::var("OPENAI_API_KEY") {
        Ok(key) => key,
        Err(_) => {
            println!("Skipping test - OPENAI_API_KEY not set");
            return;
        }
    };
    let c_api_key = CString::new(api_key).unwrap();

    // Test with null test_repo_url
    let result = verify_intent_c(
        std::ptr::null(),
        valid_str.as_ptr(),
        valid_str.as_ptr(),
        valid_str.as_ptr(),
        valid_str.as_ptr(),
        valid_str.as_ptr(),
        c_api_key.as_ptr(),
        std::ptr::null(),
        std::ptr::null(),
    );
    assert!(
        result.is_null(),
        "Should return null for null test_repo_url"
    );

    // Test with null test_commit
    let result = verify_intent_c(
        valid_str.as_ptr(),
        std::ptr::null(),
        valid_str.as_ptr(),
        valid_str.as_ptr(),
        valid_str.as_ptr(),
        valid_str.as_ptr(),
        c_api_key.as_ptr(),
        std::ptr::null(),
        std::ptr::null(),
    );
    assert!(result.is_null(), "Should return null for null test_commit");

    // Test with null solution_repo_url
    let result = verify_intent_c(
        valid_str.as_ptr(),
        valid_str.as_ptr(),
        std::ptr::null(),
        valid_str.as_ptr(),
        valid_str.as_ptr(),
        valid_str.as_ptr(),
        c_api_key.as_ptr(),
        std::ptr::null(),
        std::ptr::null(),
    );
    assert!(
        result.is_null(),
        "Should return null for null solution_repo_url"
    );

    // Test with null api_key
    let result = verify_intent_c(
        valid_str.as_ptr(),
        valid_str.as_ptr(),
        valid_str.as_ptr(),
        valid_str.as_ptr(),
        valid_str.as_ptr(),
        valid_str.as_ptr(),
        std::ptr::null(),
        std::ptr::null(),
        std::ptr::null(),
    );
    assert!(result.is_null(), "Should return null for null api_key");

    println!("\n✅ FFI null handling test completed successfully");
}
