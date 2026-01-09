# Rust Cargo Test Executor
FROM rust:latest

# Set working directory
WORKDIR /workspace

# Copy repositories (provided by build context)
COPY source-repo /workspace/source-repo
COPY test-repo /workspace/test-repo

# Create merged project structure
# Start with test repo as base (has correct Cargo.toml and test structure)
RUN cp -r test-repo project

# Override src/ with solution from source repo
RUN rm -rf project/src && \
    cp -r source-repo/src project/src

# Set working directory to the merged project
WORKDIR /workspace/project

# Build the project
RUN cargo build

# Run tests
CMD ["cargo", "test", "--", "--nocapture"]
