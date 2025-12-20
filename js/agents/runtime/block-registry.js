import { validateBlockManifest } from "../shared/block-manifest.js";

export class BlockRegistry {
  constructor() {
    this._blocks = new Map();
  }

  /**
   * Register a block and its executor.
   * @param {object} manifest
   * @param {Function} executor
   */
  register(manifest, executor) {
    const { ok, errors } = validateBlockManifest(manifest);
    if (!ok) {
      throw new Error(`Invalid block manifest: ${errors.join("; ")}`);
    }
    if (typeof executor !== "function") {
      throw new TypeError("BlockRegistry.register(manifest, executor): executor must be a function");
    }
    if (this._blocks.has(manifest.name)) {
      throw new Error(`BlockRegistry.register(manifest, executor): block already registered: ${manifest.name}`);
    }

    this._blocks.set(manifest.name, { manifest, executor });
  }

  /**
   * Return all registered block manifests.
   * @returns {object[]}
   */
  getManifests() {
    return Array.from(this._blocks.values()).map((entry) => entry.manifest);
  }

  /**
   * Get the executor for a block name.
   * @param {string} name
   * @returns {Function|undefined}
   */
  getExecutor(name) {
    return this._blocks.get(name)?.executor;
  }

  /**
   * Get the manifest for a block name.
   * @param {string} name
   * @returns {object|undefined}
   */
  getManifest(name) {
    return this._blocks.get(name)?.manifest;
  }

  /**
   * Build an AI-readable catalog prompt of registered blocks.
   * @returns {string}
   */
  buildCatalogPrompt() {
    const manifests = this.getManifests();
    if (manifests.length === 0) return "";

    return manifests
      .map((manifest) => {
        const dependsOn = manifest.dependsOn?.length ? manifest.dependsOn.join(", ") : "none";
        const incompatibleWith = manifest.incompatibleWith?.length ? manifest.incompatibleWith.join(", ") : "none";
        const capabilities = manifest.capabilities?.length ? manifest.capabilities.join(", ") : "none";
        const retryable = manifest.retryable ? "yes" : "no";

        return [
          `## ${manifest.name} (v${manifest.version})`,
          manifest.description,
          "",
          `**When to use**: ${manifest.whenToUse}`,
          `**Depends on**: ${dependsOn}`,
          `**Incompatible with**: ${incompatibleWith}`,
          `**Estimated cost**: ${manifest.estimatedCost}`,
          `**Estimated tokens**: ${manifest.estimatedTokens}`,
          `**Timeout (ms)**: ${manifest.timeoutMs}`,
          `**Retryable**: ${retryable}`,
          `**Capabilities**: ${capabilities}`,
        ].join("\n");
      })
      .join("\n\n---\n\n");
  }
}
