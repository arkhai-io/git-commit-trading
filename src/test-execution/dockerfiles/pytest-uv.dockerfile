# Python UV + Pytest Test Executor
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# Set working directory
WORKDIR /workspace

# Copy repositories (provided by build context)
COPY source-repo /workspace/source-repo
COPY test-repo /workspace/test-repo

# Create merged project structure
# Start with source repo as base (has pyproject.toml and src/)
RUN cp -r source-repo project

# Copy tests from test repo (supports multiple conventions)
# Priority: tests/, test/, *_test.py, test_*.py
RUN if [ -d test-repo/tests ]; then \
        rm -rf project/tests && cp -r test-repo/tests project/tests; \
    elif [ -d test-repo/test ]; then \
        rm -rf project/test && cp -r test-repo/test project/test; \
    else \
        find test-repo -maxdepth 1 \( -name "*_test.py" -o -name "test_*.py" \) -exec cp {} project/ \;; \
    fi

# Set working directory to the merged project
WORKDIR /workspace/project

# Install dependencies with uv
RUN uv pip install --system -e .
RUN uv pip install --system pytest

# Run tests
CMD ["python", "-m", "pytest", "-v"]
