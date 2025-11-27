use std::ffi::{CStr, CString};
use std::os::raw::c_char;

use crate::openai::{ask_openai_internal, verify_intent};

/// FFI: Call OpenAI from C/FFI
#[unsafe(no_mangle)]
pub extern "C" fn ask_openai(prompt: *const c_char, api_key: *const c_char) -> *mut c_char {
    let prompt_c_str = unsafe {
        if prompt.is_null() {
            return std::ptr::null_mut();
        }
        CStr::from_ptr(prompt)
    };

    let api_key_c_str = unsafe {
        if api_key.is_null() {
            return std::ptr::null_mut();
        }
        CStr::from_ptr(api_key)
    };

    let prompt_str = match prompt_c_str.to_str() {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };

    let api_key_str = match api_key_c_str.to_str() {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };

    let result = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(ask_openai_internal(prompt_str, api_key_str, None, None));

    match result {
        Ok(output) => CString::new(output).unwrap().into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

/// FFI: Free string allocated by ask_openai
#[unsafe(no_mangle)]
pub extern "C" fn free_str(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    unsafe {
        drop(CString::from_raw(ptr));
    }
}

/// FFI: Verify test intent with code changes
/// Returns a JSON string with the verification result
#[unsafe(no_mangle)]
pub extern "C" fn verify_intent_c(
    test_repo_url: *const c_char,
    test_commit: *const c_char,
    solution_repo_url: *const c_char,
    solution_commit1: *const c_char,
    solution_commit2: *const c_char,
    user_intent: *const c_char,
    api_key: *const c_char,
    model: *const c_char,
    base_url: *const c_char,
) -> *mut c_char {
    // Helper to convert c_char pointer to Option<&str>
    let to_str = |ptr: *const c_char| -> Option<String> {
        if ptr.is_null() {
            return None;
        }
        unsafe { CStr::from_ptr(ptr).to_str().ok().map(|s| s.to_string()) }
    };

    // Convert all required parameters
    let test_repo_url_str = match to_str(test_repo_url) {
        Some(s) => s,
        None => return std::ptr::null_mut(),
    };

    let test_commit_str = match to_str(test_commit) {
        Some(s) => s,
        None => return std::ptr::null_mut(),
    };

    let solution_repo_url_str = match to_str(solution_repo_url) {
        Some(s) => s,
        None => return std::ptr::null_mut(),
    };

    let solution_commit1_str = match to_str(solution_commit1) {
        Some(s) => s,
        None => return std::ptr::null_mut(),
    };

    let solution_commit2_str = match to_str(solution_commit2) {
        Some(s) => s,
        None => return std::ptr::null_mut(),
    };

    let user_intent_str = match to_str(user_intent) {
        Some(s) => s,
        None => return std::ptr::null_mut(),
    };

    let api_key_str = match to_str(api_key) {
        Some(s) => s,
        None => return std::ptr::null_mut(),
    };

    // Optional parameters
    let model_opt = to_str(model);
    let base_url_opt = to_str(base_url);

    // Call the async function
    let result = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(verify_intent(
            &test_repo_url_str,
            &test_commit_str,
            &solution_repo_url_str,
            &solution_commit1_str,
            &solution_commit2_str,
            &user_intent_str,
            &api_key_str,
            model_opt.as_deref(),
            base_url_opt.as_deref(),
        ));

    match result {
        Ok(verification_result) => {
            // Serialize the result to JSON
            match serde_json::to_string(&verification_result) {
                Ok(json) => CString::new(json).unwrap().into_raw(),
                Err(_) => std::ptr::null_mut(),
            }
        }
        Err(_) => std::ptr::null_mut(),
    }
}
