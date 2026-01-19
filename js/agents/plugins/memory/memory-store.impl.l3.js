import { deepClone, isPlainObject, toNonEmptyString } from "../../shared/index.js";
import { RetrievalEngine } from "./retrieval-engine.js";
import { L3Storage } from "./l3-storage.js";
import { defineGetter, defineMethod, estimateBytes, genId, truncate } from "./memory-store.impl.utils.js";

export function defineL3Layer() {
  return {
    L3: defineGetter(function () {
      const shallow = {
        snapshots: this._L3.snapshots, // Map 引用
        index: Object.freeze({
          keywords: this._L3.index.keywords,
          stages: this._L3.index.stages,
          timeline: Object.freeze([...this._L3.index.timeline]),
        }),
        checkpoints: Object.freeze([...this._L3.checkpoints]),
      };
      return Object.freeze(shallow);
    }),

    cloneL3: defineMethod(function () {
      return deepClone(this._L3);
    }),

    _getL3Storage: defineMethod(async function () {
      const existing = this._l3Storage;
      if (existing) return existing;
      const vfs = this._vfs;
      if (!vfs) return null;

      const inFlight = this._l3StoragePromise;
      if (inFlight) return await inFlight;

      this._l3StoragePromise = (async () => {
        const created = new L3Storage({ vfs, runId: this.runId });
        this._l3Storage = created;
        return created;
      })();

      return await this._l3StoragePromise;
    }),

    /**
     * 淘汰最老的 snapshot 以释放空间
     * @private
     */
    _evictOldestSnapshot: defineMethod(function () {
      const timeline = this._L3.index.timeline;
      if (timeline.length === 0) return;

      const oldest = timeline.shift();
      if (!oldest?.id) return;

      const entry = this._L3.snapshots.get(oldest.id);
      if (entry) {
        this._l3BytesUsed -= estimateBytes(entry);
        this._L3.snapshots.delete(oldest.id);
      }

      // 清理关键词索引
      for (const [, idSet] of this._L3.index.keywords) {
        idSet.delete(oldest.id);
      }
    }),

    /**
     * 淘汰最老的 checkpoint 以释放空间
     * @private
     */
    _evictOldestCheckpoint: defineMethod(function () {
      if (this._L3.checkpoints.length === 0) return;
      const oldest = this._L3.checkpoints.shift();
      if (oldest) {
        this._l3BytesUsed -= estimateBytes(oldest);
      }
    }),

    /**
     * 确保 L3 字节使用在限制内
     * @private
     * @param {number} incomingBytes - 即将添加的字节数
     */
    _ensureL3Capacity: defineMethod(function (incomingBytes) {
      const maxBytes = this.config.maxL3Bytes;
      if (!Number.isFinite(maxBytes) || maxBytes <= 0) return;

      // 优先淘汰 snapshots（摘要，重要性较低）
      while (this._l3BytesUsed + incomingBytes > maxBytes && this._L3.index.timeline.length > 0) {
        this._evictOldestSnapshot();
      }
      // 其次淘汰 checkpoints（保留更多，因为可能被 backtrack 依赖）
      while (this._l3BytesUsed + incomingBytes > maxBytes && this._L3.checkpoints.length > 1) {
        this._evictOldestCheckpoint();
      }
    }),

    archive: defineMethod(async function (stageKey, data, keywords = []) {
      const l3Storage = await this._getL3Storage();
      if (l3Storage) {
        const id = await l3Storage.archive(stageKey, data, keywords);
        const entry = await l3Storage.getSnapshot(id);
        if (entry) {
          this._emit("memory:archived", { id, stageKey: entry.stageKey, summary: entry.summary, ts: entry.ts });
          this._emit("memory:l3:archive", { id, stageKey: entry.stageKey, keywordCount: keywords.length });
        } else {
          this._emit("memory:archived", { id, stageKey, ts: Date.now() });
          this._emit("memory:l3:archive", { id, stageKey, keywordCount: keywords.length });
        }
        this._stats.archiveCount = (this._stats.archiveCount || 0) + 1;
        return id;
      }

      const id = genId("snap");
      const entry = {
        id,
        stageKey,
        data,
        summary: data.summary || truncate(JSON.stringify(data), 200),
        ts: Date.now(),
      };

      const entryBytes = estimateBytes(entry);
      this._ensureL3Capacity(entryBytes);

      // 存储
      this._L3.snapshots.set(id, entry);
      this._l3BytesUsed += entryBytes;
      this._markDirty("L3");

      // 建立关键词索引
      for (const kw of keywords) {
        const k = toNonEmptyString(kw)?.toLowerCase();
        if (!k) continue;
        if (!this._L3.index.keywords.has(k)) {
          this._L3.index.keywords.set(k, new Set());
        }
        this._L3.index.keywords.get(k).add(id);
      }

      // 阶段索引
      if (stageKey) {
        this._L3.index.stages.set(stageKey, id);
      }

      // 时间线
      this._L3.index.timeline.push({ id, ts: entry.ts, summary: entry.summary });
      this._emit("memory:archived", { id, stageKey: entry.stageKey, summary: entry.summary, ts: entry.ts });
      this._emit("memory:l3:archive", { id, stageKey: entry.stageKey, keywordCount: keywords.length });
      this._stats.archiveCount = (this._stats.archiveCount || 0) + 1;

      return id;
    }),

    _getRetrievalEngine: defineMethod(function () {
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
    }),

    /**
     * @deprecated Use `new RetrievalEngine({ memoryStore }).recall(...)`.
     */
    recall: defineMethod(function (query, limit = 3) {
      this._stats.recallCount++;
      const results = this._getRetrievalEngine().recall(query, limit);
      this._emit("memory:recall", { query: typeof query === "string" ? query.slice(0, 100) : "(non-string)", resultCount: results.length, method: "keyword" });
      return results;
    }),

    /**
     * @deprecated Use `new RetrievalEngine({ memoryStore }).semanticRecall(...)`.
     */
    semanticRecall: defineMethod(async function (query, options) {
      this._stats.recallCount++;
      const results = await this._getRetrievalEngine().semanticRecall(query, options);
      this._emit("memory:recall", { query: typeof query === "string" ? query.slice(0, 100) : "(non-string)", resultCount: results.length, method: "semantic" });
      return results;
    }),

    /**
     * @deprecated Use `new RetrievalEngine({ memoryStore }).hybridRecall(...)`.
     */
    hybridRecall: defineMethod(async function (query, options) {
      this._stats.recallCount++;
      const results = await this._getRetrievalEngine().hybridRecall(query, options);
      this._emit("memory:recall", { query: typeof query === "string" ? query.slice(0, 100) : "(non-string)", resultCount: results.length, method: "hybrid" });
      return results;
    }),

    listArchives: defineMethod(function (limit = 10) {
      return this._L3.index.timeline.slice(-limit).reverse();
    }),

    getSnapshot: defineMethod(async function (snapshotId) {
      const l3Storage = await this._getL3Storage();
      if (l3Storage) return await l3Storage.getSnapshot(snapshotId);

      const id = toNonEmptyString(snapshotId);
      if (!id) return null;
      return this._L3.snapshots.get(id) || null;
    }),

    /**
     * Create a checkpoint (uses incremental if dirty tracking available)
     * @param {Object} [options]
     * @param {boolean} [options.incremental=true] - Use incremental snapshot if possible
     * @param {number} [options.fullSnapshotEvery=5] - Force full snapshot every N checkpoints
     * @returns {Promise<string>} Checkpoint ID
     */
    checkpoint: defineMethod(async function (options) {
      const opts = isPlainObject(options) ? options : {};
      const incremental = opts.incremental ?? true;
      const fullSnapshotEvery = opts.fullSnapshotEvery ?? 5;

      const l3Storage = await this._getL3Storage();
      if (l3Storage) {
        this._recalculateTotalTokens();

        const id = genId("ckpt");
        const ts = Date.now();

        const checkpointIndex = await l3Storage.listCheckpoints();
        const checkpointCount = Array.isArray(checkpointIndex) ? checkpointIndex.length : 0;
        const shouldFull = !incremental || checkpointCount % fullSnapshotEvery === 0;

        /** @type {any} */
        let snapshot;
        if (shouldFull || !this._hasAnyDirty()) {
          snapshot = {
            id,
            runId: this.runId,
            ts,
            encoding: "full",
            L0: this.cloneL0(),
            L1: this.cloneL1(),
            L2: this.cloneL2(),
          };
        } else {
          snapshot = {
            id,
            runId: this.runId,
            ts,
            encoding: "incremental",
            dirtyLayers: { ...this._dirty },
          };
          if (this._dirty.L0) snapshot.L0 = this.cloneL0();
          if (this._dirty.L1) snapshot.L1 = this.cloneL1();
          if (this._dirty.L2) snapshot.L2 = this.cloneL2();

          const lastMeta = checkpointCount > 0 ? checkpointIndex[checkpointCount - 1] : null;
          const baseId = toNonEmptyString(lastMeta?.id);
          if (baseId) snapshot.baseId = baseId;
        }

        await l3Storage.checkpoint(snapshot);
        this._clearDirty();
        return id;
      }

      this._recalculateTotalTokens();
      const id = genId("ckpt");
      const ts = Date.now();

      const checkpointCount = this._L3.checkpoints.length;
      const shouldFull = !incremental || checkpointCount % fullSnapshotEvery === 0;

      /** @type {{
       *   id: string,
       *   runId: string,
       *   ts: number,
       *   encoding: string,
       *   dirtyLayers?: { L0: boolean, L1: boolean, L2: boolean, L3: boolean },
       *   baseId?: string,
       *   L0?: any,
       *   L1?: any,
       *   L2?: any,
       * }} */
      let snapshot;
      if (shouldFull || !this._hasAnyDirty()) {
        // Full snapshot
        snapshot = {
          id,
          runId: this.runId,
          ts,
          encoding: "full",
          L0: this.cloneL0(),
          L1: this.cloneL1(),
          L2: this.cloneL2(),
        };
      } else {
        // Incremental: only clone dirty layers
        snapshot = {
          id,
          runId: this.runId,
          ts,
          encoding: "incremental",
          dirtyLayers: { ...this._dirty },
        };
        if (this._dirty.L0) snapshot.L0 = this.cloneL0();
        if (this._dirty.L1) snapshot.L1 = this.cloneL1();
        if (this._dirty.L2) snapshot.L2 = this.cloneL2();

        // Store base checkpoint reference for restore
        const lastCkpt = this._L3.checkpoints[checkpointCount - 1];
        if (lastCkpt) snapshot.baseId = lastCkpt.id;
      }

      const snapshotBytes = estimateBytes(snapshot);
      this._ensureL3Capacity(snapshotBytes);

      this._L3.checkpoints.push(snapshot);
      this._l3BytesUsed += snapshotBytes;
      this._clearDirty(); // Reset dirty flags after checkpoint
      return id;
    }),

    /**
     * Check if any layer is dirty
     * @private
     */
    _hasAnyDirty: defineMethod(function () {
      return this._dirty.L0 || this._dirty.L1 || this._dirty.L2 || this._dirty.L3;
    }),

    restore: defineMethod(async function (checkpointId) {
      const l3Storage = await this._getL3Storage();
      if (l3Storage) {
        const id = toNonEmptyString(checkpointId);
        if (!id) return false;

        const ckpt = await l3Storage.getCheckpoint(id);
        if (!ckpt) return false;

        if (ckpt.encoding === "incremental" && ckpt.baseId) {
          const baseRestored = await this._restoreFromBaseStorage(ckpt, l3Storage);
          if (!baseRestored) {
            if (ckpt.L0) this._L0 = deepClone(ckpt.L0);
            if (ckpt.L1) this._L1 = deepClone(ckpt.L1);
            if (ckpt.L2) this._L2 = deepClone(ckpt.L2);
          }
        } else {
          if (ckpt.L0) this._L0 = deepClone(ckpt.L0);
          if (ckpt.L1) this._L1 = deepClone(ckpt.L1);
          if (ckpt.L2) this._L2 = deepClone(ckpt.L2);
        }

        this._updateTokenUsage();
        this._clearDirty();
        return true;
      }

      const ckpt = this._L3.checkpoints.find((c) => c.id === checkpointId);
      if (!ckpt) return false;

      if (ckpt.encoding === "incremental" && ckpt.baseId) {
        // Incremental restore: first restore base, then apply incremental
        const baseRestored = this._restoreFromBase(ckpt);
        if (!baseRestored) {
          // Fallback: if we have the layers, use them directly
          if (ckpt.L0) this._L0 = deepClone(ckpt.L0);
          if (ckpt.L1) this._L1 = deepClone(ckpt.L1);
          if (ckpt.L2) this._L2 = deepClone(ckpt.L2);
        }
      } else {
        // Full restore
        if (ckpt.L0) this._L0 = deepClone(ckpt.L0);
        if (ckpt.L1) this._L1 = deepClone(ckpt.L1);
        if (ckpt.L2) this._L2 = deepClone(ckpt.L2);
      }

      this._updateTokenUsage();
      this._clearDirty();
      return true;
    }),

    /**
     * Restore from base checkpoint then apply incremental changes
     * @private
     */
    _restoreFromBase: defineMethod(function (incrementalCkpt) {
      // Find the nearest full checkpoint
      let baseId = incrementalCkpt.baseId;
      const chain = [incrementalCkpt];

      while (baseId) {
        const base = this._L3.checkpoints.find((c) => c.id === baseId);
        if (!base) break;
        chain.unshift(base);
        if (base.encoding === "full") {
          // Found full checkpoint, apply chain
          for (const ckpt of chain) {
            if (ckpt.L0) this._L0 = deepClone(ckpt.L0);
            if (ckpt.L1) this._L1 = deepClone(ckpt.L1);
            if (ckpt.L2) this._L2 = deepClone(ckpt.L2);
          }
          return true;
        }
        baseId = base.baseId;
      }

      return false;
    }),

    _restoreFromBaseStorage: defineMethod(async function (incrementalCkpt, l3Storage) {
      let baseId = toNonEmptyString(incrementalCkpt?.baseId);
      const chain = [incrementalCkpt];
      const seen = new Set([toNonEmptyString(incrementalCkpt?.id) || ""]);

      while (baseId) {
        if (seen.has(baseId)) break;
        seen.add(baseId);

        const base = await l3Storage.getCheckpoint(baseId);
        if (!base) break;
        chain.unshift(base);
        if (base.encoding === "full") {
          for (const ckpt of chain) {
            if (ckpt.L0) this._L0 = deepClone(ckpt.L0);
            if (ckpt.L1) this._L1 = deepClone(ckpt.L1);
            if (ckpt.L2) this._L2 = deepClone(ckpt.L2);
          }
          return true;
        }
        baseId = toNonEmptyString(base.baseId);
      }

      return false;
    }),

    getLatestCheckpoint: defineMethod(function () {
      return this._L3.checkpoints[this._L3.checkpoints.length - 1] || null;
    }),

    /**
     * 重新计算 L3 字节使用量
     * @private
     */
    _recalculateL3Bytes: defineMethod(function () {
      let total = 0;
      for (const entry of this._L3.snapshots.values()) {
        total += estimateBytes(entry);
      }
      for (const ckpt of this._L3.checkpoints) {
        total += estimateBytes(ckpt);
      }
      this._l3BytesUsed = total;
    }),
  };
}
