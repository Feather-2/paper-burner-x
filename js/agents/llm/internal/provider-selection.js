import { assertChatMessages } from "../provider.js";
import { ModelUsage, isValidModelUsage } from "../constants.js";
import { toNonEmptyString } from "../../shared/index.js";

/**
 * @param {any[]} list
 * @param {number} startIndex
 * @returns {any[]}
 */
export function rotateFromIndex(list, startIndex) {
  const arr = Array.isArray(list) ? list : [];
  if (arr.length <= 1) return arr.slice();
  const start = ((startIndex || 0) % arr.length + arr.length) % arr.length;
  return arr.slice(start).concat(arr.slice(0, start));
}

/**
 * @param {any[]} messages
 * @returns {string}
 */
export function extractPromptText(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  const parts = [];

  for (const msg of messages) {
    const content = msg?.content;
    if (typeof content === "string") {
      if (content) parts.push(content);
      continue;
    }

    if (Array.isArray(content)) {
      for (const item of content) {
        if (!item) continue;
        if (typeof item === "string") {
          if (item) parts.push(item);
          continue;
        }
        if (typeof item?.text === "string" && item.text) {
          parts.push(item.text);
          continue;
        }
        if (typeof item?.content === "string" && item.content) {
          parts.push(item.content);
          continue;
        }
      }
      continue;
    }

    if (content !== undefined && content !== null) {
      try {
        parts.push(JSON.stringify(content));
      } catch {
        parts.push(String(content));
      }
    }
  }

  return parts.join("\n");
}

/**
 * @param {{ usage?: string, images?: any[], usageTags?: Map<string, string[]> }} input
 * @returns {Set<string>}
 */
export function getRequiredTags({ usage, images, usageTags } = {}) {
  const u = toNonEmptyString(usage) || ModelUsage.WORKER;
  const required = new Set();

  const hasImages = Array.isArray(images) && images.length > 0;
  if (hasImages || u === ModelUsage.VISION) required.add("vision");
  else required.add("text");

  const extra = usageTags?.get?.(u) || [];
  for (const t of extra) required.add(t);
  return required;
}

/**
 * @param {any} modelEntry
 * @param {Set<string>} requiredTags
 * @returns {boolean}
 */
export function supportsTags(modelEntry, requiredTags) {
  const tags = new Set(Array.isArray(modelEntry?.tags) ? modelEntry.tags : []);
  for (const t of requiredTags) if (!tags.has(t)) return false;
  return true;
}

/**
 * @param {{
 *   fromIndex: number,
 *   candidates: string[],
 *   requiredTags: Set<string>,
 *   models: Map<string, any>,
 *   isAvailable: (modelId: string) => boolean,
 * }} input
 * @returns {string | null}
 */
export function findNextCandidate({ fromIndex, candidates, requiredTags, models, isAvailable }) {
  for (let i = fromIndex; i < candidates.length; i++) {
    const id = candidates[i];
    const entry = models.get(id);
    if (!entry) continue;
    if (!supportsTags(entry, requiredTags)) continue;
    if (!isAvailable(id)) continue;
    return id;
  }
  return null;
}

/**
 * @param {{
 *   usage?: string,
 *   messages?: any[],
 *   images?: any[],
 *   waitRetryCount?: number,
 *   usageConfig: Record<string, string[]>,
 *   usageTags: Map<string, string[]>,
 *   logger: { warn: (msg: string, ...args: any[]) => void },
 *   strategy: string,
 *   rrNextIndexByUsage: Map<string, string | number>,
 *   usePerformanceRouting: boolean,
 *   beforeCandidates?: () => void,
 * }} input
 * @returns {{
 *   usage: string,
 *   requiredTags: Set<string>,
 *   waitRetryCount: number,
 *   baseCandidates: string[],
 *   orderedCandidates: string[],
 *   strategy: string,
 *   startIndex: number,
 *   usePerformanceRouting: boolean,
 * }}
 */
export function prepareCallContext({
  usage,
  messages,
  images,
  waitRetryCount,
  usageConfig,
  usageTags,
  logger,
  strategy,
  rrNextIndexByUsage,
  usePerformanceRouting,
  beforeCandidates,
}) {
  const u = toNonEmptyString(usage);
  if (!u) throw new TypeError("call({usage, messages}): usage must be a non-empty string");
  if (!isValidModelUsage(u)) {
    logger.warn(`[ModelRouter] Unknown usage type: ${u}, valid types: ${Object.values(ModelUsage).join(", ")}`);
  }
  assertChatMessages(messages);

  if (typeof beforeCandidates === "function") beforeCandidates();

  const candidates = usageConfig[u];
  if (!Array.isArray(candidates) || candidates.length === 0) throw new Error(`No models configured for usage: ${u}`);

  const requiredTags = getRequiredTags({ usage: u, images, usageTags });
  const waitCount =
    typeof waitRetryCount === "number" && Number.isFinite(waitRetryCount) ? waitRetryCount : 0;

  const baseCandidates = candidates;
  const cursor = rrNextIndexByUsage.get(u);
  let startIndex = 0;
  if (strategy === "round_robin") {
    if (typeof cursor === "string") {
      const idx = baseCandidates.indexOf(cursor);
      startIndex = idx >= 0 ? idx : 0;
    } else {
      const raw = typeof cursor === "number" && Number.isFinite(cursor) ? Math.floor(cursor) : 0;
      startIndex = ((raw % baseCandidates.length) + baseCandidates.length) % baseCandidates.length;
    }
  }
  const orderedCandidates = strategy === "round_robin" ? rotateFromIndex(baseCandidates, startIndex) : baseCandidates;

  return {
    usage: u,
    requiredTags,
    waitRetryCount: waitCount,
    baseCandidates,
    orderedCandidates,
    strategy,
    startIndex,
    usePerformanceRouting,
  };
}

/**
 * @param {{
 *   usage: string,
 *   baseCandidates: string[],
 *   images?: any[],
 *   models: Map<string, any>,
 *   performanceRouter: { registerEndpoint: (id: string, meta: { tier: string, weight: number }) => void },
 *   resolveEndpointTier: (modelId: string, modelEntry: any, options: { usage?: string, images?: any[] }) => string,
 * }} input
 * @returns {void}
 */
export function registerPerformanceCandidates({
  usage,
  baseCandidates,
  images,
  models,
  performanceRouter,
  resolveEndpointTier,
}) {
  if (!performanceRouter) return;
  for (const modelId of baseCandidates) {
    const entry = models.get(modelId);
    if (!entry) continue;
    const tier = resolveEndpointTier(modelId, entry, { usage, images });
    const weight = typeof entry.weight === "number" && Number.isFinite(entry.weight) ? entry.weight : 1.0;
    try {
      performanceRouter.registerEndpoint(modelId, { tier, weight });
    } catch {
      // ignore performance router failures (best-effort)
    }
  }
}

/**
 * @param {{
 *   usage: string,
 *   strategy: string,
 *   startIndex: number,
 *   baseCandidates: string[],
 *   requiredTags: Set<string>,
 *   models: Map<string, any>,
 *   health: Map<string, any>,
 *   isAvailable: (modelId: string) => boolean,
 *   logger: { debug: (msg: string, meta?: any) => void },
 * }} input
 * @returns {void}
 */
export function logCandidateDebug({
  usage,
  strategy,
  startIndex,
  baseCandidates,
  requiredTags,
  models,
  health,
  isAvailable,
  logger,
}) {
  const debugCandidates = baseCandidates.map((id) => {
    const entry = models.get(id);
    const healthEntry = health.get(id);
    const available = isAvailable(id);
    const hasRequiredTags = entry ? supportsTags(entry, requiredTags) : false;
    return {
      id,
      available,
      hasRequiredTags,
      unhealthyUntilMs: healthEntry?.unhealthyUntilMs,
      failures: healthEntry?.failures,
      disabled: healthEntry?.disabled === true,
    };
  });
  logger.debug(`[ModelRouter] call usage=${usage} strategy=${strategy} startIndex=${startIndex}`, {
    candidates: debugCandidates,
    requiredTags: Array.from(requiredTags),
  });
}

/**
 * @param {{
 *   usage: string,
 *   strategy: string,
 *   baseCandidates: string[],
 *   startIndex: number,
 *   selectedModelId: string | null,
 *   rrNextIndexByUsage: Map<string, string | number>,
 *   persistRoundRobin: boolean,
 *   roundRobinStorage: { setItem: (key: string, value: string) => void } | null,
 *   roundRobinStorageKey: string,
 * }} input
 * @returns {void}
 */
export function finalizeRoundRobin({
  usage,
  strategy,
  baseCandidates,
  startIndex,
  selectedModelId,
  rrNextIndexByUsage,
  persistRoundRobin,
  roundRobinStorage,
  roundRobinStorageKey,
}) {
  if (strategy !== "round_robin" || baseCandidates.length === 0) return;

  const start = ((startIndex || 0) % baseCandidates.length + baseCandidates.length) % baseCandidates.length;
  let next = (start + 1) % baseCandidates.length;
  if (selectedModelId) {
    const usedIdx = baseCandidates.indexOf(selectedModelId);
    if (usedIdx >= 0) next = (usedIdx + 1) % baseCandidates.length;
  }
  const nextModelId = baseCandidates[next];
  rrNextIndexByUsage.set(usage, toNonEmptyString(nextModelId) || next);

  if (persistRoundRobin && roundRobinStorage) {
    try {
      if (roundRobinStorageKey) {
        const obj = {};
        for (const [k, v] of rrNextIndexByUsage.entries()) obj[k] = v;
        roundRobinStorage.setItem(roundRobinStorageKey, JSON.stringify(obj));
      }
    } catch {
      // ignore
    }
  }
}
