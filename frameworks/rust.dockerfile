# Dockerfile template for merging source and test repos and running Rust tests
FROM rust:latest

# Build arguments for repository URLs
ARG SOURCE_REPO
ARG TEST_REPO

# Optional: specify branches (default to main/master)
ARG SOURCE_BRANCH=main
ARG TEST_BRANCH=main

# Install git
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /workspace

# Clone the source repository
RUN git clone --branch ${SOURCE_BRANCH} ${SOURCE_REPO} source-repo

# Clone the test repository
RUN git clone --branch ${TEST_BRANCH} ${TEST_REPO} test-repo

# Create project structure
RUN mkdir -p project

# Copy src/ from source repo
RUN cp -r source-repo/src project/src

# Copy test/ from test repo
RUN cp -r test-repo/test project/test

# Copy Cargo.toml and Cargo.lock if they exist
RUN if [ -f source-repo/Cargo.toml ]; then cp source-repo/Cargo.toml project/; fi
RUN if [ -f source-repo/Cargo.lock ]; then cp source-repo/Cargo.lock project/; fi

# Set working directory to the merged project
WORKDIR /workspace/project

# Build the project
RUN cargo build

# Run tests
CMD ["cargo", "test"]