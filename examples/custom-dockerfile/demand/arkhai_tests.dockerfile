# Custom Dockerfile Example
FROM alpine:latest

# Install bash for testing
RUN apk add --no-cache bash

WORKDIR /workspace

# Copy repositories
COPY source-repo /workspace/source-repo
COPY test-repo /workspace/test-repo

# Merge: copy source as base, then overlay tests
RUN mkdir -p project && cp -r source-repo/* project/
RUN cp -r test-repo/tests project/tests

WORKDIR /workspace/project

# Run tests
CMD ["bash", "tests/run_tests.sh"]
