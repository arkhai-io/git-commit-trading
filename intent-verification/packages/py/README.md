# Intent Verification Python

Python bindings for the intent-verification Rust library.

## Installation

### Development Setup

1. Install maturin:
```bash
pip install maturin
```

2. Build and install the package in development mode:
```bash
maturin develop
```

Or build for release:
```bash
maturin build --release
```

### Install Test Dependencies

```bash
pip install -r requirements-dev.txt
```

## Usage

```python
from intent_verification_py import verify_intent_py

result = verify_intent_py(
    test_repo_url="https://github.com/example/test-repo",
    test_commit="abc123",
    solution_repo_url="https://github.com/example/solution-repo",
    solution_commit1="def456",
    solution_commit2="ghi789",
    user_intent="I want to ensure the tests work correctly",
    api_key="your-openai-api-key",
    base_url=None,  # Optional
    model=None,     # Optional, e.g., "gpt-4"
)

print(f"Intent fulfilled: {result['is_intent_fulfilled']}")
print(f"Confidence: {result['confidence']:.2f}")
print(f"Explanation: {result['explanation']}")
```

## Running Tests

1. Set your OpenAI API key:
```bash
export OPENAI_API_KEY="your-api-key-here"
```

2. Build the package:
```bash
maturin develop
```

3. Run the tests:
```bash
pytest test_intent_verification.py -v -s
```

Or run all tests:
```bash
pytest -v -s
```

### Test Options

- `-v`: Verbose output
- `-s`: Show print statements
- `-k test_name`: Run specific test by name
- `--tb=short`: Short traceback format

Example:
```bash
pytest test_intent_verification.py -v -s -k test_verify_intent_basic
```

## Result Structure

The `verify_intent_py` function returns a dictionary with the following structure:

```python
{
    "is_intent_fulfilled": bool,        # Whether the intent was fulfilled
    "confidence": float,                # Confidence score (0.0 to 1.0)
    "explanation": str,                 # Explanation of the result
    "overall_assessment": str,          # Overall assessment text
    "files_analyzed": [                 # List of analyzed files
        {
            "file_path": str,           # Path to the file
            "change_type": str,         # Type of change (e.g., "Modified")
            "supports_intent": bool,    # Whether this file supports the intent
            "reasoning": str,           # Reasoning for the assessment
            "relevant_changes": [str]   # List of relevant changes
        }
    ]
}
```

## License

Same as the intent-verification Rust library.
# intent-verification-py
