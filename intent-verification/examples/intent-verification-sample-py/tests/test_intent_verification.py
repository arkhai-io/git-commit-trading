import os
import pytest
from dotenv import load_dotenv
from intent_verification_py import verify_intent_py

# Load environment variables from .env file
load_dotenv()


@pytest.fixture
def api_key():
    """Get API key from environment variable."""
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        pytest.skip("OPENAI_API_KEY environment variable not set")
    return key


@pytest.fixture
def test_config():
    """Default test configuration."""
    return {
        "user_intent": "I want to ensure the tests/test_main.py works correctly",
        "test_repo_url": "https://github.com/VAR-META-Tech/intent-verification-sample-py",
        "test_commit": "b9ce728166ecc8a376986d624531af90aae3167b",
        "solution_repo_url": "https://github.com/VAR-META-Tech/intent-verification-sample-py",
        "solution_commit1": "b9ce728166ecc8a376986d624531af90aae3167b",
        "solution_commit2": "8b85053596ae139d7eb6437ee74a14cc521bfe0a",
    }


def test_verify_intent_basic(api_key, test_config):
    """Test basic intent verification."""
    result = verify_intent_py(
        test_repo_url=test_config["test_repo_url"],
        test_commit=test_config["test_commit"],
        solution_repo_url=test_config["solution_repo_url"],
        solution_commit1=test_config["solution_commit1"],
        solution_commit2=test_config["solution_commit2"],
        user_intent=test_config["user_intent"],
        api_key=api_key,
    )

    # Verify result structure
    assert isinstance(result, dict)
    assert "is_intent_fulfilled" in result
    assert "confidence" in result
    assert "explanation" in result
    assert "overall_assessment" in result
    assert "files_analyzed" in result

    # Verify types
    assert isinstance(result["is_intent_fulfilled"], bool)
    assert isinstance(result["confidence"], float)
    assert isinstance(result["explanation"], str)
    assert isinstance(result["overall_assessment"], str)
    assert isinstance(result["files_analyzed"], list)

    # Verify confidence is in valid range
    assert 0.0 <= result["confidence"] <= 1.0

    # Print results for debugging
    print("\n✅ Intent Verification Result:")
    print(f"  Intent Fulfilled: {result['is_intent_fulfilled']}")
    print(f"  Confidence: {result['confidence']:.2f}")
    print(f"  Explanation: {result['explanation']}")
    print(f"\n  Overall Assessment:")
    print(f"  {result['overall_assessment']}")

    if result["files_analyzed"]:
        print(f"\n  📁 Files Analyzed ({len(result['files_analyzed'])}):")
        for file_analysis in result["files_analyzed"]:
            support_icon = "✅" if file_analysis["supports_intent"] else "❌"
            print(
                f"    {support_icon} {file_analysis['file_path']} [{file_analysis['change_type']}]"
            )
            print(f"      Reasoning: {file_analysis['reasoning']}")
            if file_analysis["relevant_changes"]:
                print(f"      Relevant Changes:")
                for change in file_analysis["relevant_changes"]:
                    print(f"        • {change}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
