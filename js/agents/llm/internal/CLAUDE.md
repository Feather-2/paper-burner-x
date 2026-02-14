# LLM ModelRouter internals (js/agents/llm/internal)

Internal helpers for ModelRouter. These modules are not a public API; call them through `js/agents/llm/model-router.js`.

## Responsibilities
- Parse and normalize ModelRouter config (cooldown/backoff, retry strategy, performance routing, logger, persistence, router strategy).
- Select candidates by usage/tags, maintain round-robin ordering, and register performance routing metadata.
- Execute model calls with rate limiting, retry/failover, circuit breaker guards, and health updates.
- Classify permanent auth failures to avoid wasteful retries when credentials are invalid.
- Track token usage and latency (best-effort telemetry) and estimate task complexity for performance routing.
- Sanitize/redact errors before logging/emitting events to avoid leaking secrets (API keys/tokens/passwords/URL creds/JWT); keep messages short and single-line.
- Maintain health and circuit breaker state with model event emission.

## Key files
- call-executor.js: execution loop, performance-vs-standard routing, failover, token tracker integration, event emission, error shaping (`toErrorInfo`) and message redaction (`redactErrorMessage`).
- config-parser.js: config parsing/normalization, router strategy setup, PerformanceRouter wiring, retry strategy, safe JSON parsing/validation, and default cooldown/backoff constants.
- provider-selection.js: candidate ordering, tag checks, required tags, perf-router registration, prompt text extraction.
- health-manager.js: health map and circuit breaker lifecycle helpers.
- fallback.js: error helpers, retry classification, permanent auth detection, cooldown/backoff calculation.
- rate-limit.js: per-model TokenBucketRateLimiter creation.

## Call flow
1. `prepareCallContext` validates usage/messages and computes required tags and candidate order.
2. `extractPromptText` (best-effort) + `estimateComplexity` derive `taskComplexity` for performance routing.
3. `registerPerformanceCandidates` registers tier/weight metadata for performance routing.
4. `executeCall` chooses `callWithPerformanceRouting` or `callWithStandardRouting`.
5. On each attempt: enforce rate limit, retry policy, and circuit breaker constraints.
6. On success: assert response shape, record token usage and latency, mark healthy, return response.
7. On failure: sanitize error (`toErrorInfo` + `redactErrorMessage`), emit events, update health/cooldown; permanent auth errors are treated as non-retriable.

## Notes
- Keep this directory internal-only; external callers should use `js/agents/llm/model-router.js`.
- Error messages exposed to logs/users should remain compact, single-line, and secret-safe.