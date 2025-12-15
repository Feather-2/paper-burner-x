#!/bin/bash
# 运行 logger 测试
cd /mnt/f/pb/paper-burner
node --test tests/agents/deepsearch/logger.test.js \
  --experimental-test-coverage \
  --test-coverage-lines=90 \
  --test-coverage-functions=90 \
  --test-coverage-branches=85 \
  --test-coverage-include=js/agents/stages/deepsearch/logger.js
