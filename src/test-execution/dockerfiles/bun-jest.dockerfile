# Bun with Jest Test Executor
FROM oven/bun:latest

# Set working directory
WORKDIR /workspace

# Copy repositories (provided by build context)
COPY source-repo /workspace/source-repo
COPY test-repo /workspace/test-repo

# Create merged project structure
# Start with source repo as base (has package.json, jest config and src/)
RUN cp -r source-repo project

# Copy tests from test repo (supports multiple conventions)
# Priority: __tests__/, tests/, test/, src/**/*.test.ts, src/**/*.spec.ts
RUN if [ -d test-repo/__tests__ ]; then \
        cp -r test-repo/__tests__ project/__tests__; \
    elif [ -d test-repo/tests ]; then \
        cp -r test-repo/tests project/tests; \
    elif [ -d test-repo/test ]; then \
        cp -r test-repo/test project/test; \
    else \
        find test-repo -name "*.test.ts" -o -name "*.spec.ts" | while read f; do \
            mkdir -p "project/$(dirname "${f#test-repo/}")"; \
            cp "$f" "project/${f#test-repo/}"; \
        done; \
    fi

# Set working directory to the merged project
WORKDIR /workspace/project

# Install dependencies
RUN bun install

# Run tests with Jest
CMD ["bun", "run", "jest"]
