use intent_verification::{ChangeType, get_git_changed_files};

#[test]
fn test_alkahest_rs_repo_diff() {
    let repo_url = "https://github.com/arkhai-io/alkahest-rs";
    let commit1 = "0879d7bc336977136c6aa1674ee52601286ff9b1";
    let commit2 = "04d80bfe66a3ac62f2d33cdcfcca859c92808e10";

    println!("Testing git diff for repository: {}", repo_url);
    println!("Between commits:");
    println!("  Commit 1: {}", &commit1[..8]);
    println!("  Commit 2: {}", &commit2[..8]);

    match get_git_changed_files(repo_url, commit1, commit2) {
        Ok(file_changes) => {
            println!("Changed files found: {}", file_changes.len());
            for (i, file_change) in file_changes.iter().enumerate() {
                if i < 5 {
                    // Show first 5 files with details
                    println!("  - {} ({:?})", file_change.path, file_change.status);
                    if let Some(content) = &file_change.content {
                        let preview = if content.len() > 100 {
                            format!("{}...", &content[..100])
                        } else {
                            content.clone()
                        };
                        println!("    Content preview: {}", preview.replace('\n', "\\n"));
                    }
                } else if i == 5 {
                    println!("  ... and {} more files", file_changes.len() - 5);
                    break;
                }
            }

            // Basic assertions
            assert!(
                file_changes.len() > 0,
                "Should find some changed files between these commits"
            );

            // Check that all returned paths are valid strings
            for file_change in &file_changes {
                assert!(
                    !file_change.path.is_empty(),
                    "File paths should not be empty"
                );
                assert!(
                    !file_change.path.contains('\0'),
                    "File paths should not contain null bytes"
                );

                // Check change types are valid
                match file_change.status {
                    ChangeType::Added | ChangeType::Modified | ChangeType::Deleted => {
                        // Valid change types
                    }
                }

                // For deleted files, content should be None
                if file_change.status == ChangeType::Deleted {
                    assert!(
                        file_change.content.is_none(),
                        "Deleted files should have no content"
                    );
                }
            }

            println!("✓ Test passed: Found {} changed files", file_changes.len());
        }
        Err(e) => {
            println!("Function failed with error: {}", e);
            // Don't panic on network errors, just skip the test
            if e.to_string().contains("network")
                || e.to_string().contains("SSL")
                || e.to_string().contains("certificate")
            {
                println!("Skipping test due to network issues");
                return;
            }
            panic!("Function failed with error: {}", e);
        }
    }
}
