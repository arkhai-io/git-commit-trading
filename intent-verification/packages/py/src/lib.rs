use pyo3::prelude::*;

use intent_verification::verify_intent;

/// Formats the sum of two numbers as string.
#[pyfunction]
fn sum_as_string(a: usize, b: usize) -> PyResult<String> {
    Ok((a + b).to_string())
}

/// Verifies if the changes in a git repository fulfill a user's intent.
///
/// Args:
///     test_repo_url: URL of the test repository
///     test_commit: Commit hash to test
///     solution_repo_url: URL of the solution repository
///     solution_commit1: First commit hash (before changes)
///     solution_commit2: Second commit hash (after changes)
///     user_intent: Description of what the user wants to achieve
///     api_key: OpenAI API key
///     base_url: Optional base URL for OpenAI API
///     model: Optional model name to use
///
/// Returns:
///     A dictionary containing the verification result
#[pyfunction]
#[pyo3(signature = (test_repo_url, test_commit, solution_repo_url, solution_commit1, solution_commit2, user_intent, api_key, base_url=None, model=None))]
fn verify_intent_py(
    py: Python<'_>,
    test_repo_url: String,
    test_commit: String,
    solution_repo_url: String,
    solution_commit1: String,
    solution_commit2: String,
    user_intent: String,
    api_key: String,
    base_url: Option<String>,
    model: Option<String>,
) -> PyResult<PyObject> {
    let runtime = tokio::runtime::Runtime::new().map_err(|e| {
        PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(format!(
            "Failed to create async runtime: {}",
            e
        ))
    })?;

    let result = py.allow_threads(|| {
        runtime.block_on(async {
            verify_intent(
                &test_repo_url,
                &test_commit,
                &solution_repo_url,
                &solution_commit1,
                &solution_commit2,
                &user_intent,
                &api_key,
                base_url.as_deref(),
                model.as_deref(),
            )
            .await
            .map_err(|e| format!("{}", e))
        })
    });

    match result {
        Ok(verification_result) => {
            let dict = pyo3::types::PyDict::new(py);
            dict.set_item(
                "is_intent_fulfilled",
                verification_result.is_intent_fulfilled,
            )?;
            dict.set_item("confidence", verification_result.confidence)?;
            dict.set_item("explanation", verification_result.explanation)?;
            dict.set_item("overall_assessment", verification_result.overall_assessment)?;

            let files_analyzed = pyo3::types::PyList::new(
                py,
                verification_result
                    .files_analyzed
                    .iter()
                    .map(|file_analysis| {
                        let file_dict = pyo3::types::PyDict::new(py);
                        file_dict
                            .set_item("file_path", &file_analysis.file_path)
                            .unwrap();
                        file_dict
                            .set_item("change_type", format!("{:?}", file_analysis.change_type))
                            .unwrap();
                        file_dict
                            .set_item("supports_intent", file_analysis.supports_intent)
                            .unwrap();
                        file_dict
                            .set_item("reasoning", &file_analysis.reasoning)
                            .unwrap();
                        file_dict
                            .set_item("relevant_changes", &file_analysis.relevant_changes)
                            .unwrap();
                        file_dict
                    }),
            )?;

            dict.set_item("files_analyzed", files_analyzed)?;

            Ok(dict.into())
        }
        Err(e) => Err(PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(format!(
            "Failed to verify intent: {}",
            e
        ))),
    }
}

/// A Python module implemented in Rust.
#[pymodule]
fn intent_verification_py(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(sum_as_string, m)?)?;
    m.add_function(wrap_pyfunction!(verify_intent_py, m)?)?;
    Ok(())
}
