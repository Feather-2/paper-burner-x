# LLM ModelRouter internals (js/agents/llm/internal)

Internal helpers for ModelRouter. These modules are not a public API; call them through `js/agents/llm/model-router.js`.

## Responsibilities
- Parse and normalize ModelRouter config (cooldown/backoff, retry, performance routing, logger).
- Select candidates by usage/tags, manage round-robin cursor, and register performance routing metadata.
- Execute model calls with rate limiting, retry, circuit breaker, and health updates.
- Track token usage and latency (best-effort telemetry).
- Maintain health and circuit breaker state.

## Key files
- call-executor.js: execution loop, perf vs standard routing, failover, event emission.
- config-parser.js: apply config, PerformanceRouter setup, round-robin persistence, retry strategy.
- provider-selection.js: candidate ordering, tag checks, required tags, perf router registration.
- health-manager.js: health map and circuit breaker lifecycle helpers.
- fallback.js: error helpers and cooldown/backoff calculation.
- rate-limit.js: per-model TokenBucketRateLimiter creation.

## Call flow
1. `prepareCallContext` validates usage/messages and computes required tags and candidate order.
2. `registerPerformanceCandidates` registers tier/weight metadata for performance routing.
3. `executeCall` chooses `callWithPerformanceRouting` or `callWithStandardRouting`.
4. On success: record token usage and latency, mark healthy, return response.
5. On failure: record perf-router failure, mark unhealthy or disable on auth errors, emit events, and fail over when possible.

## Events
- `model:unhealthy` (usage, modelId, provider, error, cooldownMs, backoffLevel, unhealthyUntilMs, disabled)
- `model:failover` (usage, fromModelId, toModelId, error)
- `circuit:stateChange` (from CircuitBreaker)

## Config notes
- `performanceRouting` overrides routing mode; otherwise uses `strategy === latency_optimized`.
- `retryStrategy` may be a custom object with `execute(fn)`; `retry`/`retryStrategy` config is normalized.
- Cooldown/backoff accepts `cooldown` object or legacy `cooldownMs`/`baseCooldownMs`/`maxCooldownMs`/`backoffMultiplier`.
- Round-robin persistence uses storage key `paperburner_modelrouter_rr_v1`, storing next index or model id per usage.

## Compatibility
- Browser-first; no Node-only APIs are used in this module.