use git2::{Delta, Repository};
use regex::Regex;
use std::path::Path;

use crate::code_parser::{extract_function_from_content_with_name, is_source_file_by_name};
use crate::types::{FileContent, FunctionContent, TestTargets, TestTargetsWithCode};

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ChangeType {
    Added,
    Modified,
    Deleted,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FileChange {
    pub path: String,
    pub status: ChangeType,
    pub content: Option<String>,
}

/// Get list of files that were added or changed between two commits
/// This function clones the repository from the given URL and compares the commits
pub fn get_git_changed_files(
    repo_url: &str,
    commit_hash_1: &str,
    commit_hash_2: &str,
) -> Result<Vec<FileChange>, Box<dyn std::error::Error>> {
    // Create a temporary directory for cloning
    let temp_dir = format!(
        "/tmp/git_changed_files_{}_{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );

    // Clean up any existing temp directory
    if Path::new(&temp_dir).exists() {
        std::fs::remove_dir_all(&temp_dir).ok();
    }

    // Clone the repository
    let repo = Repository::clone(repo_url, &temp_dir)?;

    let commit1 = repo.find_commit(repo.revparse_single(commit_hash_1)?.id())?;
    let commit2 = repo.find_commit(repo.revparse_single(commit_hash_2)?.id())?;

    let tree1 = commit1.tree()?;
    let tree2 = commit2.tree()?;

    let diff = repo.diff_tree_to_tree(Some(&tree1), Some(&tree2), None)?;

    let mut file_changes = Vec::new();

    diff.foreach(
        &mut |delta, _| {
            let (path, change_type) = match delta.status() {
                Delta::Added => {
                    if let Some(path) = delta.new_file().path() {
                        (path.to_string_lossy().to_string(), ChangeType::Added)
                    } else {
                        return true; // Skip if no path
                    }
                }
                Delta::Modified => {
                    if let Some(path) = delta.new_file().path() {
                        (path.to_string_lossy().to_string(), ChangeType::Modified)
                    } else {
                        return true; // Skip if no path
                    }
                }
                Delta::Deleted => {
                    if let Some(path) = delta.old_file().path() {
                        (path.to_string_lossy().to_string(), ChangeType::Deleted)
                    } else {
                        return true; // Skip if no path
                    }
                }
                _ => return true, // Skip other types
            };

            // Get file content for added and modified files
            let content = match change_type {
                ChangeType::Added | ChangeType::Modified => {
                    // Get the file content from the second commit (newer version)
                    match tree2.get_path(Path::new(&path)) {
                        Ok(entry) => {
                            if let Ok(blob) =
                                entry.to_object(&repo).and_then(|obj| obj.peel_to_blob())
                            {
                                // Try to convert to UTF-8 string, skip binary files
                                if blob.is_binary() {
                                    Some("[Binary file]".to_string())
                                } else {
                                    std::str::from_utf8(blob.content())
                                        .map(|s| s.to_string())
                                        .unwrap_or_else(|_| "[Non-UTF8 content]".to_string())
                                        .into()
                                }
                            } else {
                                None
                            }
                        }
                        Err(_) => None,
                    }
                }
                ChangeType::Deleted => None, // No content for deleted files
            };

            file_changes.push(FileChange {
                path,
                status: change_type,
                content,
            });

            true
        },
        None,
        None,
        None,
    )?;

    // Clean up the temporary directory
    std::fs::remove_dir_all(&temp_dir).ok();

    Ok(file_changes)
}

pub fn split_by_function(content: &str) -> Vec<String> {
    let mut blocks = vec![];

    let re = Regex::new(r#"(?m)^(pub\s+)?(async\s+)?(fn\s+\w+|function\s+\w+|const\s+\w+\s*=\s*\(|let\s+\w+\s*=\s*\(|export\s+(async\s+)?function\s+\w+)"#).unwrap();
    let mut last_index = 0;

    for mat in re.find_iter(content) {
        let start = mat.start();
        if start > last_index {
            let chunk = &content[last_index..start];
            if !chunk.trim().is_empty() {
                blocks.push(chunk.to_string());
            }
        }
        last_index = start;
    }

    if last_index < content.len() {
        blocks.push(content[last_index..].to_string());
    }

    blocks
}

/// Read the actual code content for the test targets from a git repository at a specific commit
///
/// # Arguments
/// * `targets` - The TestTargets containing function and file names
/// * `repo_url` - Git repository URL or path
/// * `commit` - Commit hash to read files from
///
/// # Returns
/// * `TestTargetsWithCode` - The targets with their actual code content
pub fn read_test_targets_code(
    targets: &TestTargets,
    repo_url: &str,
    commit: &str,
) -> Result<TestTargetsWithCode, Box<dyn std::error::Error>> {
    // Create a temporary directory for cloning if needed
    let temp_dir = format!(
        "/tmp/git_read_targets_{}_{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );

    // Clean up any existing temp directory
    if Path::new(&temp_dir).exists() {
        std::fs::remove_dir_all(&temp_dir).ok();
    }

    // Clone the repository
    let repo = Repository::clone(repo_url, &temp_dir)?;
    let commit_obj = repo.find_commit(repo.revparse_single(commit)?.id())?;
    let tree = commit_obj.tree()?;

    // Read file contents from the git tree
    let mut file_contents = Vec::new();
    for file_path in &targets.files {
        match tree.get_path(Path::new(file_path)) {
            Ok(entry) => {
                if let Ok(blob) = entry.to_object(&repo).and_then(|obj| obj.peel_to_blob()) {
                    if blob.is_binary() {
                        file_contents.push(FileContent {
                            path: file_path.clone(),
                            content: String::new(),
                            error: Some("Binary file".to_string()),
                        });
                    } else {
                        match std::str::from_utf8(blob.content()) {
                            Ok(content) => {
                                file_contents.push(FileContent {
                                    path: file_path.clone(),
                                    content: content.to_string(),
                                    error: None,
                                });
                            }
                            Err(e) => {
                                file_contents.push(FileContent {
                                    path: file_path.clone(),
                                    content: String::new(),
                                    error: Some(format!("Non-UTF8 content: {}", e)),
                                });
                            }
                        }
                    }
                } else {
                    file_contents.push(FileContent {
                        path: file_path.clone(),
                        content: String::new(),
                        error: Some("Failed to read blob".to_string()),
                    });
                }
            }
            Err(e) => {
                file_contents.push(FileContent {
                    path: file_path.clone(),
                    content: String::new(),
                    error: Some(format!("File not found in commit: {}", e)),
                });
            }
        }
    }

    // Extract function contents by searching through all source files in the tree
    let mut function_contents = Vec::new();
    for function_name in &targets.functions {
        let (found_file, found_content) = find_function_in_tree(&repo, &tree, function_name)?;

        function_contents.push(FunctionContent {
            name: function_name.clone(),
            file_path: found_file.clone(),
            content: found_content.clone(),
            error: if found_content.is_none() {
                Some(format!(
                    "Function '{}' not found in repository",
                    function_name
                ))
            } else {
                None
            },
        });
    }

    // Clean up the temporary directory
    std::fs::remove_dir_all(&temp_dir).ok();

    Ok(TestTargetsWithCode {
        targets: targets.clone(),
        file_contents,
        function_contents,
    })
}

/// Search for a function definition in a git tree recursively
fn find_function_in_tree(
    repo: &git2::Repository,
    tree: &git2::Tree,
    function_name: &str,
) -> Result<(Option<String>, Option<String>), Box<dyn std::error::Error>> {
    search_tree_for_function(repo, tree, function_name, "")
}

/// Recursive helper to search through a git tree
fn search_tree_for_function(
    repo: &git2::Repository,
    tree: &git2::Tree,
    function_name: &str,
    current_path: &str,
) -> Result<(Option<String>, Option<String>), Box<dyn std::error::Error>> {
    for entry in tree.iter() {
        let entry_name = entry.name().unwrap_or("");
        let entry_path = if current_path.is_empty() {
            entry_name.to_string()
        } else {
            format!("{}/{}", current_path, entry_name)
        };

        // Skip target and hidden directories
        if entry_name == "target" || entry_name.starts_with('.') {
            continue;
        }

        match entry.kind() {
            Some(git2::ObjectType::Tree) => {
                // Recursively search subdirectories
                if let Ok(subtree) = entry.to_object(repo).and_then(|obj| obj.peel_to_tree()) {
                    let (found_file, found_content) =
                        search_tree_for_function(repo, &subtree, function_name, &entry_path)?;
                    if found_content.is_some() {
                        return Ok((found_file, found_content));
                    }
                }
            }
            Some(git2::ObjectType::Blob) => {
                // Check if this is a source file
                if is_source_file_by_name(entry_name) {
                    if let Ok(blob) = entry.to_object(repo).and_then(|obj| obj.peel_to_blob()) {
                        if !blob.is_binary() {
                            if let Ok(content) = std::str::from_utf8(blob.content()) {
                                if let Some(function_content) =
                                    extract_function_from_content_with_name(
                                        content,
                                        function_name,
                                        entry_name,
                                    )
                                {
                                    return Ok((Some(entry_path), Some(function_content)));
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    Ok((None, None))
}
