# Audit History - internal

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] Error handling
*Archived: 2026-01-19T23:46:28.108Z*

- **File**: js/agents/llm/internal/call-executor.js:366
- **Description**: Telemetry/perf-router failures are swallowed without any logging, making diagnostics harder and conflicting with the no-empty-catch guideline.
- **Suggestion**: Log at debug level or emit a non-fatal diagnostic event so failures are visible without breaking calls.
```
try { getGlobalTokenTracker().record({ ... }); } catch { // ignore tracker errors }
```

---

## Archived: 2026-01-19

### [RESOLVED] JSDoc/type safety
*Archived: 2026-01-19T23:46:03.251Z*

- **File**: js/agents/llm/internal/call-executor.js:8
- **Description**: Exported call executor APIs use `any` and omit param descriptions, violating the JSDoc rules (no `any`, `@param` must include descriptions).
- **Suggestion**: Define @typedefs for router/options, replace `any` with concrete types, and add `- description` text for each @param.
```
@param {{ router: any, usage?: string, messages?: any[], images?: any[], waitRetryCount?: number }} input
```

---

## Archived: 2026-01-19

### [RESOLVED] Sensitive info leakage
*Archived: 2026-01-19T23:45:59.159Z*

- **File**: js/agents/llm/internal/call-executor.js:226
- **Description**: Failure logs and events include raw provider error messages; upstream auth errors can embed API keys/tokens and leak them via logs or listeners (also in the standard routing branch).
- **Suggestion**: Redact secrets from error messages before logging/emitting, or log only error codes and keep raw errors in protected telemetry.
```
router._logger.warn(`[ModelRouter] fail ${modelId} via ${entry.provider}: ${toErrorInfo(err).message}`);
```

---

