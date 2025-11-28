# Multi-stage build for Oracle service
FROM oven/bun:1 AS base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    # Build tools
    clang \
    build-essential \
    make \
    cmake \
    pkg-config \
    # Python and uv
    python3 \
    python3-pip \
    python3-venv \
    curl \
    # Git and version control
    git \
    # GPG and SSH tools for commit verification
    gnupg \
    gpg-agent \
    openssh-client \
    # Rust toolchain (for Rust projects)
    rustc \
    cargo \
    # Other utilities
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install uv (Python package manager)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:/root/.cargo/bin:$PATH"

# Set working directory
WORKDIR /app

# Configure git before installing dependencies (needed for git-based dependencies)
RUN git config --global --add safe.directory '*' && \
    git config --global user.email "docker@oracle" && \
    git config --global user.name "Oracle Docker"

# Clone and install git dependency locally (more reliable than Bun's git dependency resolution)
RUN mkdir -p /tmp/deps && \
    cd /tmp/deps && \
    git clone --depth 1 --branch mlegls-dev https://github.com/principia-systems/alkahest-ts.git && \
    cd alkahest-ts && \
    bun install && \
    bun run build 2>/dev/null || true

# Copy package files
COPY package.json bun.lock ./

# Install dependencies (including devDependencies)
# Note: Not using --frozen-lockfile to allow platform-specific dependency resolution
# The lockfile may need updates for Linux/Docker environment
RUN bun install --verbose --force

# Link the locally cloned git dependency to node_modules
RUN mkdir -p /app/node_modules && \
    ln -sf /tmp/deps/alkahest-ts /app/node_modules/alkahest-ts

# Copy application code
COPY . .

# Ensure scripts directory exists and is executable
RUN mkdir -p /app/scripts && \
    chmod +x /app/scripts/*.sh 2>/dev/null || true

# Reinstall dependencies after copying code (git dep already linked)
RUN bun install --force

# Create directories for temp files and git operations
RUN mkdir -p /tmp/git-escrows /tmp/git-verify && \
    chmod 777 /tmp/git-escrows /tmp/git-verify

# Set up Git configuration (minimal, can be overridden)
RUN git config --global --add safe.directory '*'

# Expose port (Cloud Run will set PORT env var)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD bun --version || exit 1

# Use startup script for Cloud Run
ENTRYPOINT ["/app/scripts/cloud-run-start.sh"]

