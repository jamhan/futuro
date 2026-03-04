#!/usr/bin/env bash
# Verify Docker builds succeed before deploying.
# Run: ./scripts/docker-build-test.sh

set -e
echo "Building Dockerfile.server..."
docker build -f Dockerfile.server -t oraclebook-server:test .
echo "Building Dockerfile.worker..."
docker build -f Dockerfile.worker -t oraclebook-worker:test .
echo "OK: Both images built successfully"
