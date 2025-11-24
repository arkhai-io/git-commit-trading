# PNPM with Jest Test Executor
FROM node:20-slim

# Build arguments for repository configuration
ARG SOURCE_REPO
ARG SOURCE_COMMIT
ARG TEST_REPO
ARG TEST_COMMIT

# Install git and pnpm
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm

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
# Start with test repo as base (has correct package.json, jest config and test structure)
RUN cp -r test-repo project

# Override src/ with solution from source repo
RUN rm -rf project/src && \
    cp -r source-repo/src project/src

# Set working directory to the merged project
WORKDIR /workspace/project

# Install dependencies
RUN pnpm install --frozen-lockfile

# Run tests
CMD ["pnpm", "test"]
