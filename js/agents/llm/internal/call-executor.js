import { assertChatResponse } from "../provider.js";
import { extractPromptText } from "./provider-selection.js";
import { getGlobalTokenTracker } from "../../plugins/telemetry/index.js";
import { estimateComplexity } from "../performance-router.js";
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
 * @typedef {RoutingInput & { taskComplexity: import("../performance-router.js").TaskComplexityType }} PerformanceRoutingInput
 */

const REDACTED = "[REDACTED]";
const MAX_ERROR_MESSAGE_CHARS = 500;
const DEFAULT_COOLDOWN_WAIT_MAX_RETRIES = 1;
const DEFAULT_COOLDOWN_WAIT_MAX_MS = 30_000;
const DEFAULT_COOLDOWN_WAIT_BUFFER_MS = 100;
const DEFAULT_COOLDOWN_WAIT_BACKOFF_MULTIPLIER = 1;

function normalizeNonNegativeInt(value, fallback) {
  const n = typeof value === "number" && Number.isFinite(value) ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function normalizeWaitRetryCount(waitRetryCount) {
  return normalizeNonNegativeInt(waitRetryCount, 0);
}

/**
 * @param {ModelRouter} router
 * @returns {{ maxRetries: number, maxWaitMs: number, bufferMs: number, backoffMultiplier: number }}
 */
function getCooldownWaitPolicy(router) {
  const maxRetries = normalizeNonNegativeInt(router?._cooldownWaitMaxRetries, DEFAULT_COOLDOWN_WAIT_MAX_RETRIES);
  const maxWaitMs = normalizeNonNegativeInt(router?._cooldownWaitMaxMs, DEFAULT_COOLDOWN_WAIT_MAX_MS);
  const bufferMs = normalizeNonNegativeInt(router?._cooldownWaitBufferMs, DEFAULT_COOLDOWN_WAIT_BUFFER_MS);
  const backoffMultiplierRaw = Number(router?._cooldownWaitBackoffMultiplier);
  const backoffMultiplier =
    Number.isFinite(backoffMultiplierRaw) && backoffMultiplierRaw > 0
      ? Math.max(1, backoffMultiplierRaw)
      : DEFAULT_COOLDOWN_WAIT_BACKOFF_MULTIPLIER;
  return { maxRetries, maxWaitMs, bufferMs, backoffMultiplier };
}

/**
 * @param {{
 *   router: ModelRouter,
 *   usage: string,
 *   messages: Array<unknown>,
 *   images?: Array<unknown>,
 *   eligibleCandidates: string[],
 *   waitRetryCount: number,
 * }} input
 * @returns {Promise<{content: string, model: string, provider: string, latencyMs: number} | null>}
 */
async function maybeWaitForCooldownAndRetry({ router, usage, messages, images, eligibleCandidates, waitRetryCount }) {
  const { maxRetries, maxWaitMs, bufferMs, backoffMultiplier } = getCooldownWaitPolicy(router);
  const attempt = normalizeWaitRetryCount(waitRetryCount);
  if (maxRetries <= 0 || attempt >= maxRetries) return null;

  const waitInfo = router._getShortestCooldown(eligibleCandidates);
  if (!waitInfo || typeof waitInfo.remainingMs !== "number" || !Number.isFinite(waitInfo.remainingMs) || waitInfo.remainingMs <= 0) {
    return null;
  }

  const baseWaitMs = Math.ceil(waitInfo.remainingMs);
  const backoffFactor = Math.pow(backoffMultiplier, attempt);
  const boundedWaitMs = Math.ceil(baseWaitMs * backoffFactor);
  if (maxWaitMs > 0 && boundedWaitMs > maxWaitMs) return null;

  const waitMs = Math.max(0, boundedWaitMs + bufferMs);
  router._logger.info(`[ModelRouter] all models in cooldown, waiting ${waitMs}ms for ${waitInfo.modelId}`);
  try {
    router.emit("model:cooldown-wait", {
      usage,
      modelId: waitInfo.modelId || null,
      attempt: attempt + 1,
      maxRetries,
      waitMs,
      remainingMs: waitInfo.remainingMs,
    });
  } catch {
    // ignore event emission failures
  }
  await router._time.sleep(waitMs);
  router._logger.info("[ModelRouter] retry after cooldown wait");
  return /** @type {Promise<{content: string, model: string, provider: string, latencyMs: number}>} */ (
    router.call({ usage, messages, images, _waitRetryCount: attempt + 1 })
  );
}

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
 * Try a single model: build call chain, execute, record metrics, handle errors.
 * Extracted from callWithPerformanceRouting / callWithStandardRouting (AC2).
 *
 * @param {object} ctx
 * @param {ModelRouter} ctx.router
 * @param {string} ctx.modelId
 * @param {string} ctx.usage
 * @param {Array<unknown>} ctx.messages
 * @param {Array<unknown>=} ctx.images
 * @returns {Promise<{content: string, model: string, provider: string, latencyMs: number}>}
 */
async function _tryModel({ router, modelId, usage, messages, images }) {
  const entry = router._models.get(modelId);
  if (!entry) throw new Error(`Unknown model id: ${modelId}`);

  const provider = router._getProvider(entry.provider);
  if (!provider) throw new Error(`Missing provider: ${entry.provider} for model ${modelId}`);

  const limiter = router._getRateLimiter(entry);
  const circuitBreaker = router._getCircuitBreaker(modelId);

  router._logger.debug(`[ModelRouter] try ${modelId} via ${entry.provider}`);

  const doChat = () => provider.chat({ model: entry.id, messages, images });
  const doChatWithCB = circuitBreaker ? () => circuitBreaker.execute(doChat) : doChat;
  const callStartMs = router._time.now();
  const executeOnce = () =>
    limiter ? limiter.schedule(doChatWithCB, { label: `${usage}:${modelId}` }) : doChatWithCB();

  try {
    const resp = router._retryStrategy ? await router._retryStrategy.execute(executeOnce) : await executeOnce();
    assertChatResponse(resp);

    const latencyMs = router._time.now() - callStartMs;

    // P1: Extract usage with explicit missing flag
    const promptTokens = resp.usage?.promptTokens || resp.usage?.prompt_tokens || 0;
    const completionTokens = resp.usage?.completionTokens || resp.usage?.completion_tokens || 0;
    const usageMissing = !resp.usage || (promptTokens === 0 && completionTokens === 0);

    try {
      getGlobalTokenTracker().record({
        model: entry.id,
        provider: entry.provider,
        usage,
        promptTokens,
        completionTokens,
        latencyMs,
        success: true,
        ...(usageMissing ? { usageMissing: true } : {}),
      });
    } catch (err) {
      router._logger.debug(`[ModelRouter] token tracker failed for ${entry.id}: ${redactErrorMessage(err)}`);
    }

    // P1: Emit unified metrics event
    try {
      router.emit("llm:call:metrics", {
        usage,
        modelId: entry.id,
        provider: entry.provider,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        latencyMs,
        success: true,
        usageMissing,
      });
    } catch (err) {
      router._logger.debug(`[ModelRouter] metrics event failed for ${entry.id}: ${redactErrorMessage(err)}`);
    }

    try {
      router._performanceRouter.recordResult(modelId, { success: true, latencyMs });
    } catch (err) {
      router._logger.debug(`[ModelRouter] perf router record failed for ${modelId}: ${redactErrorMessage(err)}`);
    }

    router.markHealthy(modelId);
    router._logger.debug(`[ModelRouter] ok ${modelId} via ${entry.provider} (${latencyMs}ms)`);
    return { ...resp, model: entry.id, provider: entry.provider, latencyMs };
  } catch (err) {
    const errorInfo = toSafeErrorInfo(err);
    const latencyMs = router._time.now() - callStartMs;

    try {
      router._performanceRouter.recordResult(modelId, { success: false, latencyMs, error: errorInfo.message });
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

    router._logger.warn(`[ModelRouter] fail ${modelId} via ${entry.provider}: ${errorInfo.message}`);
    const permanent = isPermanentAuthError(err);
    const health = permanent ? router.disableModel(modelId, err, { reason: "auth" }) : router.markUnhealthy(modelId, err);

    // P1: Emit unified metrics event for failures
    try {
      router.emit("llm:call:metrics", {
        usage,
        modelId,
        provider: entry.provider,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs,
        success: false,
        usageMissing: true,
        error: errorInfo,
      });
    } catch (emitErr) {
      router._logger.debug(`[ModelRouter] metrics event failed for ${modelId}: ${redactErrorMessage(emitErr)}`);
    }

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

    err._errorInfo = errorInfo;
    throw err;
  }
}

/**
 * @param {Partial<CallExecutorInput> | null} [input] - Call execution inputs.
 * @returns {Promise<{content: string, model: string, provider: string}>}
 */
export async function executeCall(input) {
  const { router, usage, messages, images, waitRetryCount } = /** @type {Partial<CallExecutorInput>} */ (input ?? {});
  if (!router) throw new Error("executeCall: router is required");
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
  const normalizedWaitRetryCount = normalizeWaitRetryCount(waitRetryCount);
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

    // Pre-check circuit breaker before _tryModel
    const circuitBreaker = router._getCircuitBreaker(modelId);
    if (circuitBreaker && !circuitBreaker.canExecute()) {
      tried.add(modelId);
      cooldownCount++;
      router._logger.debug(`[ModelRouter] skip ${modelId}: circuit breaker ${circuitBreaker.state}`);
      continue;
    }

    triedCount++;
    try {
      return await _tryModel({ router, modelId, usage, messages, images });
    } catch (err) {
      lastError = err;
      tried.add(modelId);

      const { available: remaining } = computeAvailability();
      const next = remaining.length
        ? router._performanceRouter.selectEndpoint({ complexity: taskComplexity, includeIds: remaining })?.endpointId ||
          remaining[0]
        : null;

      if (next) {
        const errorInfo = err._errorInfo || toSafeErrorInfo(err);
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
    const retry = await maybeWaitForCooldownAndRetry({
      router,
      usage,
      messages,
      images,
      eligibleCandidates,
      waitRetryCount: normalizedWaitRetryCount,
    });
    if (retry) return retry;
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
  const normalizedWaitRetryCount = normalizeWaitRetryCount(waitRetryCount);
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

    triedCount++;
    try {
      return await _tryModel({ router, modelId, usage, messages, images });
    } catch (err) {
      lastError = err;

      const nextModelId = router._findNextCandidate(idx + 1, orderedCandidates, requiredTags);
      if (nextModelId) {
        const errorInfo = err._errorInfo || toSafeErrorInfo(err);
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
    const retry = await maybeWaitForCooldownAndRetry({
      router,
      usage,
      messages,
      images,
      eligibleCandidates,
      waitRetryCount: normalizedWaitRetryCount,
    });
    if (retry) return retry;
  }

  const msg = `All models failed for usage: ${usage}`;
  const e = new Error(msg);
  e.cause = lastError instanceof Error ? lastError : undefined;
  throw e;
}
