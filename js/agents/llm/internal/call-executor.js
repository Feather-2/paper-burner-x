import { assertChatResponse } from "../provider.js";
import { extractPromptText } from "./provider-selection.js";
import { getGlobalTokenTracker } from "../../plugins/telemetry/index.js";
import { estimateComplexity } from "../../runtime/routing/performance-router.js";
import { toNonEmptyString } from "../../shared/index.js";
import { isPermanentAuthError, toErrorInfo } from "./fallback.js";

/**
 * @typedef {import("../model-router.js").ModelRouter} ModelRouter
 */

/**
 * @typedef {object} CallExecutorInput
 * @property {ModelRouter} router - ModelRouter instance.
 * @property {string=} usage - Usage label for routing.
 * @property {Array<unknown>=} messages - Chat messages for the provider call.
 * @property {Array<unknown>=} images - Optional image payloads.
 * @property {number=} waitRetryCount - Retry count for cooldown waits.
 */

/**
 * @typedef {object} RoutingInput
 * @property {ModelRouter} router - ModelRouter instance.
 * @property {string} usage - Usage label for routing.
 * @property {Array<unknown>} messages - Chat messages for the provider call.
 * @property {Array<unknown>=} images - Optional image payloads.
 * @property {Set<string>} requiredTags - Required model tags.
 * @property {string[]} orderedCandidates - Ordered candidate model ids.
 * @property {number} waitRetryCount - Retry count for cooldown waits.
 */

/**
 * @typedef {RoutingInput & { taskComplexity: import("../../plugins/routing/performance-router.js").TaskComplexityType }} PerformanceRoutingInput
 */

const REDACTED = "[REDACTED]";
const MAX_ERROR_MESSAGE_CHARS = 500;

/**
 * @param {unknown} err - Raw error to sanitize.
 * @returns {string} Redacted error message.
 */
function redactErrorMessage(err) {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) return "Unknown error";

  let msg = normalized;
  msg = msg.replace(/(authorization\s*:\s*)(bearer|token)\s+([^\s"']+)/gi, (_m, prefix, scheme) => `${prefix}${scheme} ${REDACTED}`);
  msg = msg.replace(/\b((?:access|refresh|id)?_?token|api[_-]?key|password|passwd|pwd|secret|authorization|auth)=([^\s&]+)/gi, (_m, key) => `${key}=${REDACTED}`);
  msg = msg.replace(/\B--(token|password|passwd|pwd|secret|api[_-]?key)=([^\s]+)/gi, (_m, key) => `--${key}=${REDACTED}`);
  msg = msg.replace(/\B--(token|password|passwd|pwd|secret|api[_-]?key)\s+([^\s]+)/gi, (_m, key) => `--${key} ${REDACTED}`);
  msg = msg.replace(/(\b--user\s+)([^\s:]+):([^\s]+)/gi, (_m, prefix, user) => `${prefix}${user}:${REDACTED}`);
  msg = msg.replace(/(\B-u\s+)([^\s:]+):([^\s]+)/g, (_m, prefix, user) => `${prefix}${user}:${REDACTED}`);
  msg = msg.replace(/(\/\/[^/\s:@]+:)([^@\s]+)(@)/g, (_m, prefix, _pw, suffix) => `${prefix}${REDACTED}${suffix}`);
  msg = msg.replace(/\bsk-[A-Za-z0-9]{16,}\b/g, `sk-${REDACTED}`);
  msg = msg.replace(/\bghp_[A-Za-z0-9]{20,}\b/g, `ghp_${REDACTED}`);
  msg = msg.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, `github_pat_${REDACTED}`);
  msg = msg.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, `xox-...-${REDACTED}`);
  msg = msg.replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\b/g, REDACTED);

  if (msg.length <= MAX_ERROR_MESSAGE_CHARS) return msg;
  return msg.slice(0, Math.max(0, MAX_ERROR_MESSAGE_CHARS - 3)) + "...";
}

/**
 * @param {unknown} err - Raw error to sanitize.
 * @returns {{ name: string, message: string }} Redacted error info.
 */
function toSafeErrorInfo(err) {
  const info = toErrorInfo(err);
  return { name: info.name, message: redactErrorMessage(info.message) };
}

/**
 * @param {CallExecutorInput} [input] - Call execution inputs.
 * @returns {Promise<{content: string, model: string, provider: string}>}
 */
export async function executeCall({ router, usage, messages, images, waitRetryCount } = {}) {
  const ctx = router._prepareCallContext({ usage, messages, images, _waitRetryCount: waitRetryCount });
  const {
    usage: u,
    requiredTags,
    waitRetryCount: retryCount,
    baseCandidates,
    orderedCandidates,
    strategy,
    startIndex,
    usePerformanceRouting,
  } = ctx;

  router._registerPerformanceCandidates({ usage: u, baseCandidates, images });
  router._logCandidateDebug({ usage: u, strategy, startIndex, baseCandidates, requiredTags });

  let selectedModelId = null;
  const taskComplexity = estimateComplexity({ prompt: extractPromptText(messages) });

  try {
    const result = usePerformanceRouting
      ? await callWithPerformanceRouting({
          router,
          usage: u,
          messages,
          images,
          requiredTags,
          orderedCandidates,
          taskComplexity,
          waitRetryCount: retryCount,
        })
      : await callWithStandardRouting({
          router,
          usage: u,
          messages,
          images,
          requiredTags,
          orderedCandidates,
          waitRetryCount: retryCount,
        });

    selectedModelId = toNonEmptyString(result?.model);
    return result;
  } finally {
    router._finalizeRoundRobin({ usage: u, strategy, baseCandidates, startIndex, selectedModelId });
  }
}

/**
 * @param {PerformanceRoutingInput} input - Performance routing inputs.
 * @returns {Promise<{content: string, model: string, provider: string, latencyMs: number}>}
 */
export async function callWithPerformanceRouting({
  router,
  usage,
  messages,
  images,
  requiredTags,
  orderedCandidates,
  taskComplexity,
  waitRetryCount,
}) {
  let lastError = null;
  const eligibleCandidates = [];
  const tried = new Set();
  let triedCount = 0;
  let eligibleCount = 0;
  let cooldownCount = 0;

  for (const modelId of orderedCandidates) {
    const entry = router._models.get(modelId);
    if (!entry) throw new Error(`Unknown model id: ${modelId}`);
    if (!router._supportsTags(entry, requiredTags)) {
      router._logger.debug(`[ModelRouter] skip ${modelId}: missing required tags`);
      continue;
    }
    eligibleCount++;
    eligibleCandidates.push(modelId);
  }

  const computeAvailability = () => {
    const available = [];
    let cooldown = 0;

    for (const modelId of eligibleCandidates) {
      if (tried.has(modelId)) continue;
      if (!router.isAvailable(modelId)) {
        cooldown++;
        continue;
      }
      const circuitBreaker = router._getCircuitBreaker(modelId);
      if (circuitBreaker && !circuitBreaker.canExecute()) {
        cooldown++;
        continue;
      }
      available.push(modelId);
    }

    return { available, cooldown };
  };

  while (true) {
    const { available, cooldown } = computeAvailability();
    cooldownCount = cooldown + tried.size;
    if (available.length === 0) break;

    const decision = router._performanceRouter.selectEndpoint({
      complexity: taskComplexity,
      includeIds: available,
      excludeIds: [...tried],
    });
    const modelId = decision?.endpointId || available[0];

    const entry = router._models.get(modelId);
    if (!entry) throw new Error(`Unknown model id: ${modelId}`);

    const provider = router._getProvider(entry.provider);
    if (!provider) throw new Error(`Missing provider: ${entry.provider} for model ${modelId}`);

    const limiter = router._getRateLimiter(entry);

    // P3.3: check circuit breaker status.
    const circuitBreaker = router._getCircuitBreaker(modelId);
    if (circuitBreaker && !circuitBreaker.canExecute()) {
      tried.add(modelId);
      cooldownCount++;
      router._logger.debug(`[ModelRouter] skip ${modelId}: circuit breaker ${circuitBreaker.state}`);
      continue;
    }

    triedCount++;
    router._logger.debug(`[ModelRouter] try ${modelId} via ${entry.provider}`);

    // P3.3: wrap call with circuit breaker.
    const doChat = () => provider.chat({ model: entry.id, messages, images });
    const doChatWithCircuitBreaker = circuitBreaker ? () => circuitBreaker.execute(doChat) : doChat;

    // P4.3: time the call.
    const callStartMs = router._time.now();

    const executeOnce = () =>
      limiter ? limiter.schedule(doChatWithCircuitBreaker, { label: `${usage}:${modelId}` }) : doChatWithCircuitBreaker();

    try {
      const resp = router._retryStrategy ? await router._retryStrategy.execute(executeOnce) : await executeOnce();
      assertChatResponse(resp);

      const callEndMs = router._time.now();
      const latencyMs = callEndMs - callStartMs;

      // P4.3: record token usage.
      try {
        getGlobalTokenTracker().record({
          model: entry.id,
          provider: entry.provider,
          usage,
          promptTokens: resp.usage?.promptTokens || resp.usage?.prompt_tokens || 0,
          completionTokens: resp.usage?.completionTokens || resp.usage?.completion_tokens || 0,
          latencyMs,
          success: true,
        });
      } catch (err) {
        router._logger.debug(`[ModelRouter] token tracker failed for ${entry.id}: ${redactErrorMessage(err)}`);
      }

      // PerfRouter: record success.
      try {
        router._performanceRouter.recordResult(modelId, { success: true, latencyMs });
      } catch (err) {
        router._logger.debug(`[ModelRouter] perf router record failed for ${modelId}: ${redactErrorMessage(err)}`);
      }

      router.markHealthy(modelId);
      router._logger.debug(`[ModelRouter] ok ${modelId} via ${entry.provider} (${latencyMs}ms)`);
      return { ...resp, model: entry.id, provider: entry.provider, latencyMs };
    } catch (err) {
      lastError = err;
      const errorInfo = toSafeErrorInfo(err);
      const errorMessage = errorInfo.message;

      const callEndMs = router._time.now();
      const latencyMs = callEndMs - callStartMs;

      // PerfRouter: record failure.
      try {
        router._performanceRouter.recordResult(modelId, {
          success: false,
          latencyMs,
          error: errorMessage,
        });
      } catch (recordErr) {
        router._logger.debug(`[ModelRouter] perf router record failed for ${modelId}: ${redactErrorMessage(recordErr)}`);
      }

      const retryAfterMs =
        typeof err?.retryAfterMs === "number" && Number.isFinite(err.retryAfterMs) && err.retryAfterMs > 0
          ? Math.floor(err.retryAfterMs)
          : null;
      if (retryAfterMs && limiter && typeof limiter.blockFor === "function") {
        limiter.blockFor(retryAfterMs);
      }
      router._logger.warn(`[ModelRouter] fail ${modelId} via ${entry.provider}: ${errorMessage}`);
      const permanent = isPermanentAuthError(err);
      const health = permanent ? router.disableModel(modelId, err, { reason: "auth" }) : router.markUnhealthy(modelId, err);
      router.emit("model:unhealthy", {
        usage,
        modelId,
        provider: entry.provider,
        error: errorInfo,
        cooldownMs: health?.cooldownMs ?? router._cooldownMs,
        backoffLevel: health?.backoffLevel,
        unhealthyUntilMs: health?.unhealthyUntilMs,
        ...(health?.disabled ? { disabled: true, disabledReason: health.disabledReason || "auth" } : {}),
      });

      tried.add(modelId);

      const { available: remaining } = computeAvailability();
      const next = remaining.length
        ? router._performanceRouter.selectEndpoint({ complexity: taskComplexity, includeIds: remaining })?.endpointId ||
          remaining[0]
        : null;

      if (next) {
        router.emit("model:failover", {
          usage,
          fromModelId: modelId,
          toModelId: next,
          error: errorInfo,
        });
        router._logger.info(`[ModelRouter] failover ${modelId} -> ${next}`);
      }
      continue;
    }
  }

  // After trying all candidates: if all are in cooldown, wait briefly and retry once.
  if (triedCount === 0 && eligibleCount > 0 && cooldownCount === eligibleCount) {
    const waitInfo = router._getShortestCooldown(eligibleCandidates);
    if (waitRetryCount < 1 && waitInfo && waitInfo.remainingMs > 0 && waitInfo.remainingMs < 30_000) {
      const waitMs = Math.ceil(waitInfo.remainingMs);
      router._logger.info(`[ModelRouter] all models in cooldown, waiting ${waitMs}ms for ${waitInfo.modelId}`);
      await router._time.sleep(waitMs + 100);
      router._logger.info(`[ModelRouter] retry after cooldown wait`);
      return router.call({ usage, messages, images, _waitRetryCount: waitRetryCount + 1 });
    }
  }

  const msg = `All models failed for usage: ${usage}`;
  const e = new Error(msg);
  e.cause = lastError instanceof Error ? lastError : undefined;
  throw e;
}

/**
 * @param {RoutingInput} input - Standard routing inputs.
 * @returns {Promise<{content: string, model: string, provider: string, latencyMs: number}>}
 */
export async function callWithStandardRouting({
  router,
  usage,
  messages,
  images,
  requiredTags,
  orderedCandidates,
  waitRetryCount,
}) {
  let lastError = null;
  let triedCount = 0;
  let eligibleCount = 0;
  let cooldownCount = 0;
  const eligibleCandidates = [];

  for (let idx = 0; idx < orderedCandidates.length; idx++) {
    const modelId = orderedCandidates[idx];
    const entry = router._models.get(modelId);
    if (!entry) throw new Error(`Unknown model id: ${modelId}`);

    if (!router._supportsTags(entry, requiredTags)) {
      router._logger.debug(`[ModelRouter] skip ${modelId}: missing required tags`);
      continue;
    }
    eligibleCount++;
    eligibleCandidates.push(modelId);
    if (!router.isAvailable(modelId)) {
      const h = router._health.get(modelId);
      const until =
        h?.disabled === true
          ? "disabled"
          : typeof h?.unhealthyUntilMs === "number" && Number.isFinite(h.unhealthyUntilMs)
            ? new Date(h.unhealthyUntilMs).toISOString()
            : "unknown";
      router._logger.debug(`[ModelRouter] skip ${modelId}: unhealthy until ${until}`);
      cooldownCount++;
      continue;
    }

    // P3.3: check circuit breaker status.
    const circuitBreaker = router._getCircuitBreaker(modelId);
    if (circuitBreaker && !circuitBreaker.canExecute()) {
      const cbState = circuitBreaker.state;
      router._logger.debug(`[ModelRouter] skip ${modelId}: circuit breaker ${cbState}`);
      cooldownCount++;
      continue;
    }

    const provider = router._getProvider(entry.provider);
    if (!provider) throw new Error(`Missing provider: ${entry.provider} for model ${modelId}`);

    const limiter = router._getRateLimiter(entry);

    let callStartMs = null;
    try {
      triedCount++;
      router._logger.debug(`[ModelRouter] try ${modelId} via ${entry.provider}`);

      // P3.3: wrap call with circuit breaker.
      const doChat = () => provider.chat({ model: entry.id, messages, images });
      const doChatWithCircuitBreaker = circuitBreaker ? () => circuitBreaker.execute(doChat) : doChat;

      // P4.3: time the call.
      callStartMs = router._time.now();

      const executeOnce = () =>
        limiter ? limiter.schedule(doChatWithCircuitBreaker, { label: `${usage}:${modelId}` }) : doChatWithCircuitBreaker();

      const resp = router._retryStrategy ? await router._retryStrategy.execute(executeOnce) : await executeOnce();
      assertChatResponse(resp);

      const callEndMs = router._time.now();
      const latencyMs = callEndMs - callStartMs;

      // P4.3: record token usage.
      try {
        getGlobalTokenTracker().record({
          model: entry.id,
          provider: entry.provider,
          usage,
          promptTokens: resp.usage?.promptTokens || resp.usage?.prompt_tokens || 0,
          completionTokens: resp.usage?.completionTokens || resp.usage?.completion_tokens || 0,
          latencyMs,
          success: true,
        });
      } catch (err) {
        router._logger.debug(`[ModelRouter] token tracker failed for ${entry.id}: ${redactErrorMessage(err)}`);
      }

      // PerfRouter: record success.
      try {
        router._performanceRouter.recordResult(modelId, { success: true, latencyMs });
      } catch (err) {
        router._logger.debug(`[ModelRouter] perf router record failed for ${modelId}: ${redactErrorMessage(err)}`);
      }

      router.markHealthy(modelId);
      router._logger.debug(`[ModelRouter] ok ${modelId} via ${entry.provider} (${latencyMs}ms)`);
      return { ...resp, model: entry.id, provider: entry.provider, latencyMs };
    } catch (err) {
      lastError = err;
      const errorInfo = toSafeErrorInfo(err);
      const errorMessage = errorInfo.message;

      const callEndMs = router._time.now();
      const latencyMs = typeof callStartMs === "number" ? callEndMs - callStartMs : 0;

      // PerfRouter: record failure.
      try {
        router._performanceRouter.recordResult(modelId, {
          success: false,
          latencyMs,
          error: errorMessage,
        });
      } catch (recordErr) {
        router._logger.debug(`[ModelRouter] perf router record failed for ${modelId}: ${redactErrorMessage(recordErr)}`);
      }

      const retryAfterMs =
        typeof err?.retryAfterMs === "number" && Number.isFinite(err.retryAfterMs) && err.retryAfterMs > 0
          ? Math.floor(err.retryAfterMs)
          : null;
      if (retryAfterMs && limiter && typeof limiter.blockFor === "function") {
        limiter.blockFor(retryAfterMs);
      }
      router._logger.warn(`[ModelRouter] fail ${modelId} via ${entry.provider}: ${errorMessage}`);
      const permanent = isPermanentAuthError(err);
      const health = permanent ? router.disableModel(modelId, err, { reason: "auth" }) : router.markUnhealthy(modelId, err);
      router.emit("model:unhealthy", {
        usage,
        modelId,
        provider: entry.provider,
        error: errorInfo,
        cooldownMs: health?.cooldownMs ?? router._cooldownMs,
        backoffLevel: health?.backoffLevel,
        unhealthyUntilMs: health?.unhealthyUntilMs,
        ...(health?.disabled ? { disabled: true, disabledReason: health.disabledReason || "auth" } : {}),
      });

      const nextModelId = router._findNextCandidate(idx + 1, orderedCandidates, requiredTags);
      if (nextModelId) {
        router.emit("model:failover", {
          usage,
          fromModelId: modelId,
          toModelId: nextModelId,
          error: errorInfo,
        });
        router._logger.info(`[ModelRouter] failover ${modelId} -> ${nextModelId}`);
      }
      continue;
    }
  }

  // After trying all candidates: if all are in cooldown, wait briefly and retry once.
  if (triedCount === 0 && eligibleCount > 0 && cooldownCount === eligibleCount) {
    const waitInfo = router._getShortestCooldown(eligibleCandidates);
    if (waitRetryCount < 1 && waitInfo && waitInfo.remainingMs > 0 && waitInfo.remainingMs < 30_000) {
      const waitMs = Math.ceil(waitInfo.remainingMs);
      router._logger.info(`[ModelRouter] all models in cooldown, waiting ${waitMs}ms for ${waitInfo.modelId}`);
      await router._time.sleep(waitMs + 100);
      router._logger.info(`[ModelRouter] retry after cooldown wait`);
      return router.call({ usage, messages, images, _waitRetryCount: waitRetryCount + 1 });
    }
  }

  const msg = `All models failed for usage: ${usage}`;
  const e = new Error(msg);
  e.cause = lastError instanceof Error ? lastError : undefined;
  throw e;
}
