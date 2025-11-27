#![deny(clippy::all)]
use intent_verification::verify_intent as verify_intent_rs;
use napi_derive::napi;

#[napi]
pub async fn verify_intent(
  test_repo_url: String,
  test_commit: String,
  solution_repo_url: String,
  solution_commit1: String,
  solution_commit2: String,
  user_intent: String,
  api_key: String,
  model: Option<String>,
  base_url: Option<String>,
) -> napi::Result<String> {
  let result = verify_intent_rs(
    &test_repo_url,
    &test_commit,
    &solution_repo_url,
    &solution_commit1,
    &solution_commit2,
    &user_intent,
    &api_key,
    model.as_deref(),
    base_url.as_deref(),
  )
  .await
  .map_err(|e| napi::Error::from_reason(e.to_string()))?;

  serde_json::to_string(&result).map_err(|e| napi::Error::from_reason(e.to_string()))
}
