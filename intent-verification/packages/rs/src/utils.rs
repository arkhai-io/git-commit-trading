/// Extract JSON from an OpenAI response
///
/// Looks for JSON block between braces. Returns the original response if no JSON is found.
pub fn extract_json_from_response(response: &str) -> String {
    // Look for JSON block between ```json and ``` or just find { ... }
    if let Some(start) = response.find('{') {
        if let Some(end) = response.rfind('}') {
            if end > start {
                return response[start..=end].to_string();
            }
        }
    }

    // If no JSON found, return the original response
    response.to_string()
}
