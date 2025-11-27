import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / 'src'))

from main import sum


def test_sum_positive_numbers():
    """Test sum with positive numbers."""
    assert sum(2, 3) == 5
    assert sum(10, 20) == 30

