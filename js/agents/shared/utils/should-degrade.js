/**
 * Shared error-boundary degrade check.
 *
 * Extracted from DeepSearchAgentLoop and DesignAgentLoop to eliminate
 * near-identical closures.
 *
 * @param {object} [opts]
 * @param {object} [opts.stageApi]   - stage API object (may carry errorBoundaryConfig)
 * @param {object[]} [opts.configs]  - additional config objects to inspect
 * @returns {boolean}
 */
export function shouldDegrade({ stageApi, configs = [] } = {}) {
  const cfg =
    stageApi && typeof stageApi === "object" && stageApi.errorBoundaryConfig && typeof stageApi.errorBoundaryConfig === "object"
      ? stageApi.errorBoundaryConfig
      : null;
  if (cfg?.degrade === true) return true;
  if (stageApi?.errorBoundaryDegrade === true || stageApi?.degradeOnError === true) return true;
  for (const c of configs) {
    if (c?.errorBoundary?.degrade === true) return true;
    if (c?.degradeOnError === true) return true;
  }
  return false;
}
