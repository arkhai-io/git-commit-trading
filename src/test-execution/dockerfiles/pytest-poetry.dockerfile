# Python Poetry + Pytest Test Executor
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install poetry
RUN curl -sSL https://install.python-poetry.org | python3 -
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

# Install dependencies with poetry
RUN poetry install --with dev

# Run tests
CMD ["poetry", "run", "pytest", "-v"]
