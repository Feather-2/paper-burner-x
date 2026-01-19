import { RetrievalEngine } from "./retrieval-engine.js";

export function applyIndexMethods(UnifiedMemoryStore) {
  UnifiedMemoryStore.prototype._getRetrievalEngine = function _getRetrievalEngine() {
    const engine = this._retrievalEngine;
    if (engine && typeof engine === "object" && typeof engine.recall === "function") return engine;
    const next = new RetrievalEngine({
      memoryStore: this,
      embeddingService: this._embeddingService,
      vectorIndex: this._vectorIndex,
      eventBus: this.eventBus,
    });
    this._retrievalEngine = next;
    return next;
  };

  /**
   * @deprecated Use `new RetrievalEngine({ memoryStore }).recall(...)`.
   */
  UnifiedMemoryStore.prototype.recall = function recall(query, limit = 3) {
    this._stats.recallCount += 1;
    return this._getRetrievalEngine().recall(query, limit);
  };

  /**
   * @deprecated Use `new RetrievalEngine({ memoryStore }).semanticRecall(...)`.
   */
  UnifiedMemoryStore.prototype.semanticRecall = async function semanticRecall(query, options) {
    this._stats.recallCount += 1;
    return await this._getRetrievalEngine().semanticRecall(query, options);
  };

  /**
   * @deprecated Use `new RetrievalEngine({ memoryStore }).hybridRecall(...)`.
   */
  UnifiedMemoryStore.prototype.hybridRecall = async function hybridRecall(query, options) {
    this._stats.recallCount += 1;
    return await this._getRetrievalEngine().hybridRecall(query, options);
  };
}
