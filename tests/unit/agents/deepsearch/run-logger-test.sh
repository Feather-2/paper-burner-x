#!/bin/bash
# 运行 logger 测试
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
node --test tests/agents/deepsearch/logger.test.js \
  --experimental-test-coverage \
  --test-coverage-lines=90 \
  --test-coverage-functions=90 \
  --test-coverage-branches=85 \
  --test-coverage-include=js/agents/stages/deepsearch/logger.js
