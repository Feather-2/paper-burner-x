import { TokenBucketRateLimiter } from "../rate-limit.js";

/**
 * @typedef {{ now: () => number, sleep: (ms: number) => Promise<void> }} ModelRouterTime
 */

/**
 * @param {{ rateLimiters: Map<string, TokenBucketRateLimiter>, modelEntry: any, time: ModelRouterTime }} input
 * @returns {TokenBucketRateLimiter | null}
 */
export function getRateLimiter({ rateLimiters, modelEntry, time }) {
  const id = modelEntry?.id;
  if (!id) return null;
  const perSecond = modelEntry?.limits?.rateLimit;
  if (!perSecond) return null;

  if (!rateLimiters.has(id)) {
    const rps = perSecond === Infinity ? Infinity : Number(perSecond);
    if (!Number.isFinite(rps) && rps !== Infinity) return null;
    if (rps !== Infinity && rps <= 0) return null;
    rateLimiters.set(
      id,
      new TokenBucketRateLimiter({
        rps,
        burst: 1,
        concurrency: 1,
        maxQueue: 500,
        time,
      })
    );
  }

  return rateLimiters.get(id) || null;
}
