# Python UV + Pytest Test Executor
FROM python:3.11-slim

# Build arguments for repository configuration
ARG SOURCE_REPO
ARG SOURCE_COMMIT
ARG TEST_REPO
ARG TEST_COMMIT

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.cargo/bin:${PATH}"

# Set working directory
WORKDIR /workspace

# Clone the source repository and checkout specific commit
RUN git clone ${SOURCE_REPO} source-repo && \
    cd source-repo && \
    git checkout ${SOURCE_COMMIT}

# Clone the test repository and checkout specific commit
RUN git clone ${TEST_REPO} test-repo && \
    cd test-repo && \
    git checkout ${TEST_COMMIT}

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

# Install dependencies with uv
RUN uv pip install --system -e .
RUN uv pip install --system pytest

# Run tests
CMD ["python", "-m", "pytest", "-v"]
