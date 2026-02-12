# Rust Cargo Test Executor
FROM rust:latest

# Set working directory
WORKDIR /workspace

# Copy repositories (provided by build context)
COPY source-repo /workspace/source-repo
COPY test-repo /workspace/test-repo

# Create merged project structure
# Start with source repo as base (has Cargo.toml and src/)
RUN cp -r source-repo project

# Copy tests from test repo
# Rust tests can be in tests/ directory or as #[cfg(test)] in src/
RUN if [ -d test-repo/tests ]; then \
        rm -rf project/tests && cp -r test-repo/tests project/tests; \
    fi

# Set working directory to the merged project
WORKDIR /workspace/project

# Build the project
RUN cargo build

# Run tests
CMD ["cargo", "test", "--", "--nocapture"]
