// Git-related functionality
mod git;
pub use git::{ChangeType, FileChange, get_git_changed_files, read_test_targets_code};

// Type definitions
mod types;
pub use types::{
    FileContent, FileIntentAnalysis, FunctionContent, IntentVerificationResult, TestTargets,
    TestTargetsWithCode,
};

// Utility functions
mod utils;
pub use utils::extract_json_from_response;

// Code parsing utilities
mod code_parser;
pub use code_parser::{extract_function_from_content_with_name, is_source_file_by_name};

// OpenAI-related functionality
mod openai;
pub use openai::{ask_openai_internal, extract_test_targets_with_ai, verify_intent};

// FFI-related functionality
mod ffi;
pub use ffi::{ask_openai, free_str, verify_intent_c};
