# LLM ModelRouter internals (js/agents/llm/internal)

Internal helpers for ModelRouter. These modules are not a public API; call them through `js/agents/llm/model-router.js`.

## Responsibilities
- Parse and normalize ModelRouter config (cooldown/backoff, retry, performance routing, logger, persistence).
- Select candidates by usage/tags, manage round-robin cursor, and register performance routing metadata.
- Execute model calls with rate limiting, retry, circuit breaker, and health updates.
- Track token usage and latency (best-effort telemetry) and estimate task complexity for performance routing.
- Sanitize/redact errors before logging/emitting events to avoid leaking secrets (API keys/tokens/passwords); keep messages short and single-line.
- Maintain health and circuit breaker state.

## Key files
- call-executor.js: execution loop, perf vs standard routing, failover, event emission, error shaping (`toErrorInfo`) + message redaction (`redactErrorMessage`) with length cap.
- config-parser.js: apply config, PerformanceRouter setup, round-robin persistence, retry strategy, safe JSON parsing/validation, default cooldown/backoff constants.
- provider-selection.js: candidate ordering, tag checks, required tags, perf router registration, prompt text extraction.
- health-manager.js: health map and circuit breaker lifecycle helpers.
- fallback.js: error helpers and cooldown/backoff calculation.
- rate-limit.js: per-model TokenBucketRateLimiter creation.

## Call flow
1. `prepareCallContext` validates usage/messages and computes required tags and candidate order.
2. `extractPromptText` (best-effort) + `estimateComplexity` derive `taskComplexity` for performance routing.
3. `registerPerformanceCandidates` registers tier/weight metadata for performance routing.
4. `executeCall` chooses `callWithPerformanceRouting` or `callWithStandardRouting`.
5. On success: record token usage and latency, mark healthy, return response.
6. On failure: sanitize error (`toErrorInfo` + redacted message), record perf-router failure, mark unhealthy or disable on permanent auth errors, emit events, and either fail over to the next candidate or rethrow when no candidates remain.
