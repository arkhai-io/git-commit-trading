use crate::ChangeType;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TestTargets {
    pub functions: Vec<String>,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TestTargetsWithCode {
    pub targets: TestTargets,
    pub file_contents: Vec<FileContent>,
    pub function_contents: Vec<FunctionContent>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FunctionContent {
    pub name: String,
    pub file_path: Option<String>,
    pub content: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IntentVerificationResult {
    pub is_intent_fulfilled: bool,
    pub confidence: f32,
    pub explanation: String,
    pub files_analyzed: Vec<FileIntentAnalysis>,
    pub overall_assessment: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FileIntentAnalysis {
    pub file_path: String,
    pub change_type: ChangeType,
    pub supports_intent: bool,
    pub reasoning: String,
    pub relevant_changes: Vec<String>,
}
