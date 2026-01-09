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
# Start with test repo as base (has correct pyproject.toml and test structure)
RUN cp -r test-repo project

# Override source files with solution from source repo
# Python projects may have src/ directory or .py files at root
RUN if [ -d source-repo/src ]; then \
        rm -rf project/src && cp -r source-repo/src project/src; \
    else \
        find source-repo -maxdepth 1 -name "*.py" -exec cp {} project/ \;; \
    fi

# Set working directory to the merged project
WORKDIR /workspace/project

# Install dependencies with poetry
RUN poetry install --with dev

# Run tests
CMD ["poetry", "run", "pytest", "-v"]
