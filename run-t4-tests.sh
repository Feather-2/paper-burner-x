#!/bin/bash

set -e

echo "=========================================="
echo "Running T4 - Unit Tests for Payload Format"
echo "=========================================="

echo ""
echo "1. Testing batch-generator.js..."
node --test tests/agents/design/batch-generator.test.js \
  --experimental-test-coverage \
  --test-coverage-lines=90 \
  --test-coverage-functions=90 \
  --test-coverage-branches=85 \
  --test-coverage-include=js/agents/stages/design/batch-generator.js

echo ""
echo "=========================================="
echo "All T4 tests passed!"
echo "=========================================="
