/**
 * Design phase shared helpers.
 */

export const DESIGN_PHASE_DEFAULTS = {
  costPerHDSlot: 0.04,
  costPerBasicSlot: 0.003,
  refineRecommendedSteps: 5,
  refineHardLimit: 15,
};

/**
 * @param {any} traceContext
 * @param {string} name
 * @param {Record<string, any>} attributes
 * @param {() => Promise<any>} fn
 * @returns {Promise<any>}
 */
export async function runWithPhaseSpan(traceContext, name, attributes, fn) {
  if (!traceContext || typeof traceContext.withSpan !== "function") {
    return fn();
  }
  return traceContext.withSpan(name, async (span) => {
    if (span && typeof span.setAttributes === "function") {
      span.setAttributes(attributes);
    }
    return fn();
  });
}
