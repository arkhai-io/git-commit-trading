#!/bin/bash
set -e

echo "Running custom dockerfile tests..."

# Source the functions
source src/math.sh

# Test add function
result=$(add 2 3)
if [ "$result" -eq 5 ]; then
    echo "✅ add(2, 3) = 5 PASSED"
else
    echo "❌ add(2, 3) expected 5, got $result"
    exit 1
fi

# Test subtract function
result=$(subtract 10 4)
if [ "$result" -eq 6 ]; then
    echo "✅ subtract(10, 4) = 6 PASSED"
else
    echo "❌ subtract(10, 4) expected 6, got $result"
    exit 1
fi

# Test multiply function
result=$(multiply 3 7)
if [ "$result" -eq 21 ]; then
    echo "✅ multiply(3, 7) = 21 PASSED"
else
    echo "❌ multiply(3, 7) expected 21, got $result"
    exit 1
fi

echo ""
echo "All tests passed!"
