/// Check if a filename is a source code file (TypeScript, Rust, Python)
pub fn is_source_file_by_name(filename: &str) -> bool {
    filename.ends_with(".rs")
        || filename.ends_with(".py")
        || filename.ends_with(".ts")
        || filename.ends_with(".tsx")
        || filename.ends_with(".js")
        || filename.ends_with(".jsx")
}

/// Extract a function's content from source code with filename (supports Rust, Python, TypeScript/JavaScript)
pub fn extract_function_from_content_with_name(
    content: &str,
    function_name: &str,
    filename: &str,
) -> Option<String> {
    if filename.ends_with(".rs") {
        extract_rust_function(content, function_name)
    } else if filename.ends_with(".py") {
        extract_python_function(content, function_name)
    } else if filename.ends_with(".js")
        || filename.ends_with(".ts")
        || filename.ends_with(".jsx")
        || filename.ends_with(".tsx")
    {
        extract_javascript_function(content, function_name)
    } else {
        None
    }
}

/// Extract Rust function
fn extract_rust_function(content: &str, function_name: &str) -> Option<String> {
    // Look for function definitions: pub fn, async fn, fn
    let patterns = [
        format!(r"pub async fn {}(", function_name),
        format!(r"pub fn {}(", function_name),
        format!(r"async fn {}(", function_name),
        format!(r"fn {}(", function_name),
        format!(r"pub unsafe fn {}(", function_name),
        format!(r"unsafe fn {}(", function_name),
    ];

    for pattern in &patterns {
        if let Some(start_pos) = content.find(pattern) {
            // Find the start of the function (look backwards for any attributes or doc comments)
            let mut func_start = start_pos;
            let lines: Vec<&str> = content[..start_pos].lines().collect();

            // Look backwards for attributes and doc comments
            for line in lines.iter().rev() {
                let trimmed = line.trim();
                if trimmed.starts_with("#[")
                    || trimmed.starts_with("///")
                    || trimmed.starts_with("//!")
                    || trimmed.is_empty()
                {
                    if let Some(pos) = content[..func_start].rfind(trimmed) {
                        func_start = pos;
                    }
                } else {
                    break;
                }
            }

            // Find the end of the function by counting braces
            let remaining = &content[start_pos..];
            if let Some(first_brace) = remaining.find('{') {
                let mut brace_count = 0;
                let mut in_string = false;
                let mut in_char = false;
                let mut escape_next = false;
                let mut func_end = start_pos + first_brace;

                for (i, ch) in remaining[first_brace..].char_indices() {
                    if escape_next {
                        escape_next = false;
                        continue;
                    }

                    match ch {
                        '\\' => escape_next = true,
                        '"' if !in_char => in_string = !in_string,
                        '\'' if !in_string => in_char = !in_char,
                        '{' if !in_string && !in_char => brace_count += 1,
                        '}' if !in_string && !in_char => {
                            brace_count -= 1;
                            if brace_count == 0 {
                                func_end = start_pos + first_brace + i + 1;
                                break;
                            }
                        }
                        _ => {}
                    }
                }

                if brace_count == 0 {
                    return Some(content[func_start..func_end].to_string());
                }
            }
        }
    }

    None
}

/// Extract Python function (def or async def)
fn extract_python_function(content: &str, function_name: &str) -> Option<String> {
    let patterns = [
        format!("async def {}(", function_name),
        format!("def {}(", function_name),
    ];

    for pattern in &patterns {
        if let Some(start_pos) = content.find(pattern) {
            let mut func_start = start_pos;

            // Look backwards for decorators
            let lines: Vec<&str> = content[..start_pos].lines().collect();
            for line in lines.iter().rev() {
                let trimmed = line.trim();
                if trimmed.starts_with('@') || trimmed.starts_with('#') || trimmed.is_empty() {
                    if let Some(pos) = content[..func_start].rfind(trimmed) {
                        func_start = pos;
                    }
                } else {
                    break;
                }
            }

            // Find end by tracking indentation
            let lines_after: Vec<&str> = content[start_pos..].lines().collect();
            if let Some(first_line) = lines_after.first() {
                let base_indent = first_line.len() - first_line.trim_start().len();
                let mut func_end = start_pos;
                let mut found_body = false;

                for line in &lines_after[1..] {
                    if line.trim().is_empty() {
                        func_end += line.len() + 1;
                        continue;
                    }

                    let line_indent = line.len() - line.trim_start().len();
                    if found_body && line_indent <= base_indent && !line.trim().is_empty() {
                        break;
                    }

                    found_body = true;
                    func_end += line.len() + 1;
                }

                return Some(content[func_start..func_end].to_string());
            }
        }
    }

    None
}

/// Extract JavaScript/TypeScript function
fn extract_javascript_function(content: &str, function_name: &str) -> Option<String> {
    let patterns = [
        format!("async function {}(", function_name),
        format!("function {}(", function_name),
        format!("const {} = (", function_name),
        format!("let {} = (", function_name),
        format!("var {} = (", function_name),
        format!("const {} = async (", function_name),
        format!("export function {}(", function_name),
        format!("export async function {}(", function_name),
        format!("{}(", function_name), // method definition
    ];

    for pattern in &patterns {
        if let Some(start_pos) = content.find(pattern) {
            if let Some(brace_start) = content[start_pos..].find('{') {
                let func_end = find_matching_brace(content, start_pos + brace_start)?;
                return Some(content[start_pos..func_end].to_string());
            }
        }
    }

    None
}

/// Find the matching closing brace for an opening brace
fn find_matching_brace(content: &str, open_brace_pos: usize) -> Option<usize> {
    let mut brace_count = 0;
    let mut in_string = false;
    let in_char = false;
    let mut escape_next = false;
    let mut string_char = '"';

    for (i, ch) in content[open_brace_pos..].char_indices() {
        if escape_next {
            escape_next = false;
            continue;
        }

        match ch {
            '\\' => escape_next = true,
            '"' | '\'' if !in_char && !in_string => {
                in_string = true;
                string_char = ch;
            }
            c if in_string && c == string_char => in_string = false,
            '{' if !in_string && !in_char => brace_count += 1,
            '}' if !in_string && !in_char => {
                brace_count -= 1;
                if brace_count == 0 {
                    return Some(open_brace_pos + i + 1);
                }
            }
            _ => {}
        }
    }

    None
}
