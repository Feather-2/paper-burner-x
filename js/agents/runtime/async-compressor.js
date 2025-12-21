import { toNonEmptyString } from "../shared/value-utils.js";

const DEFAULT_LAYERS = Object.freeze(["tool_output"]);

function normalizeLayers(layers) {
  if (!Array.isArray(layers) || layers.length === 0) return [...DEFAULT_LAYERS];
  return layers
    .map((layer) => (layer === null || layer === undefined ? "" : String(layer).trim()))
    .filter(Boolean);
}

/**
 * 异步压缩器 - 不阻塞主流程的压缩机制
 * @example
 * const compressor = new AsyncCompressor({ cicada, layers: ['tool_output'] });
 * compressor.schedule('scan', scanResult); // 立即返回
 * // ... 执行下一个 Stage ...
 * compressor.applyReady(context); // 热替换已完成的压缩
 * await compressor.flush(); // 等待所有压缩完成
 */
export class AsyncCompressor {
  /**
   * @param {Object} options
   * @param {import('./cicada-compressor.js').CicadaCompressor} options.cicada - 压缩器实例
   * @param {string[]} [options.layers=['tool_output']] - 压缩层配置
   */
  constructor({ cicada, layers } = {}) {
    if (!cicada || typeof cicada.compress !== "function") {
      throw new Error("AsyncCompressor: cicada.compress() is required");
    }

    this.cicada = cicada;
    this.layers = normalizeLayers(layers);

    /** @type {Map<string, Promise<void>>} */
    this.pending = new Map();
    /** @type {Map<string, any>} */
    this.ready = new Map();
    /** @type {Map<string, any>} */
    this.failed = new Map();

    this._completed = new Set();
    this._scheduleSeq = 0;
    this._stageSeq = new Map();
    this._pendingGroups = new Map();
  }

  /**
   * 触发异步压缩（立即返回，不阻塞）
   * @param {string} stageId - Stage 标识符
   * @param {Object} result - Stage 输出结果
   */
  schedule(stageId, result) {
    const id = toNonEmptyString(stageId);
    if (!id) throw new Error("AsyncCompressor.schedule: stageId must be a non-empty string");

    const seq = (this._scheduleSeq += 1);
    this._stageSeq.set(id, seq);

    this.ready.delete(id);
    this.failed.delete(id);
    this._completed.delete(id);

    let group = this._pendingGroups.get(id);
    if (!group) {
      let resolve;
      const promise = new Promise((res) => {
        resolve = res;
      });
      group = { count: 0, resolve, promise };
      this._pendingGroups.set(id, group);
      this.pending.set(id, promise);
    }
    group.count += 1;

    Promise.resolve()
      .then(async () => {
        const out = await this.cicada.compress(result, { layers: this.layers });
        const compressed =
          out && typeof out === "object" && Object.prototype.hasOwnProperty.call(out, "context")
            ? out.context
            : out;

        if (this._stageSeq.get(id) !== seq) return;
        this.ready.set(id, compressed);
        this._completed.add(id);
      })
      .catch((error) => {
        if (this._stageSeq.get(id) !== seq) return;
        this.failed.set(id, error);
      })
      .finally(() => {
        const current = this._pendingGroups.get(id);
        if (!current) return;
        current.count -= 1;
        if (current.count > 0) return;

        this._pendingGroups.delete(id);
        this.pending.delete(id);
        current.resolve?.();
      });
  }

  /**
   * 热替换已完成的压缩结果
   * @param {Object} context - 包含 stageResults 的上下文对象
   * @returns {Object} 修改后的 context（同一对象引用）
   */
  applyReady(context) {
    if (!context || typeof context !== "object") return context;
    const container = context.stageResults;
    if (!container || (typeof container !== "object" && !(container instanceof Map))) return context;
    if (this.ready.size === 0) return context;

    for (const [stageId, compressed] of Array.from(this.ready.entries())) {
      if (container instanceof Map) container.set(stageId, compressed);
      else container[stageId] = compressed;
      this.ready.delete(stageId);
    }

    return context;
  }

  /**
   * 等待所有压缩任务完成
   * @returns {Promise<{ completed: string[], pending: string[], failed: Array<{stageId, error}> }>}
   */
  async flush() {
    while (this.pending.size) {
      const tasks = Array.from(this.pending.values());
      await Promise.all(tasks);
    }

    const completed = Array.from(this._completed).sort();
    const pending = Array.from(this.pending.keys()).sort();
    const failed = Array.from(this.failed.entries())
      .map(([stageId, error]) => ({ stageId, error }))
      .sort((a, b) => a.stageId.localeCompare(b.stageId));

    return { completed, pending, failed };
  }

  /**
   * 检查是否有待处理的压缩任务
   * @returns {boolean}
   */
  hasPending() {
    return this.pending.size > 0;
  }

  /**
   * 获取压缩状态
   * @returns {{ pending: string[], ready: string[], failed: string[] }}
   */
  getStatus() {
    return {
      pending: Array.from(this.pending.keys()).sort(),
      ready: Array.from(this.ready.keys()).sort(),
      failed: Array.from(this.failed.keys()).sort(),
    };
  }
}

export default AsyncCompressor;
