import { StorageVfs } from "../../vfs/vfs.storage.js";
import { safeJsonParse } from "../../shared/index.js";
import { createLogger } from "../../shared/index.js";
import { isPlainObject, safeInt, toNonEmptyString } from "../../shared/index.js";
import { makeSecureTimestampedId } from "../../shared/index.js";

const logger = createLogger("runtime/checkpoints/agent");

const CHECKPOINT_SCHEMA_VERSION = "0.1";
const CHECKPOINT_KIND = "agent_checkpoint";
const INDEX_KIND = "agent_checkpoint_index";
const INDEX_FILE = "index.json";

/** @type {Map<string, Promise<void>>} */
const indexLocks = new Map();

/**
 * 简易互斥锁 - 保证同一 runId 的索引操作串行
 * @param {string} runId
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
async function withIndexLock(runId, fn) {
  const key = runId || "__default__";
  while (indexLocks.has(key)) {
    await indexLocks.get(key);
  }
  let release;
  const lock = new Promise((resolve) => {
    release = resolve;
  });
  indexLocks.set(key, lock);
  try {
    return await fn();
  } finally {
    indexLocks.delete(key);
    release();
  }
}

/**
 * 安全化路径段 - 仅保留安全字符并拒绝危险模式
 * @private
 * @param {unknown} value - 原始值
 * @param {string} fallback - 空值回退
 * @returns {string} 安全化后的路径段
 * @throws {Error} 如果值包含路径遍历模式 (. 或 ..)
 */
function safeSegment(value, fallback) {
  const raw = toNonEmptyString(value);
  if (!raw) return fallback;
  // 拒绝 . 或 .. 路径遍历
  if (raw === "." || raw === "..") {
    throw new Error(`Invalid path segment: "${raw}" (path traversal not allowed)`);
  }
  const sanitized = raw.replace(/[^a-zA-Z0-9._-]/g, "_");
  // 二次检查：规范化后仍可能产生 . 或 ..
  if (sanitized === "." || sanitized === "..") {
    throw new Error(`Invalid path segment after sanitization: "${sanitized}"`);
  }
  return sanitized;
}

function buildCheckpointDir(runId) {
  const safeRunId = safeSegment(runId, "run");
  return `.agents/runs/${safeRunId}/checkpoints`;
}

function buildCheckpointPath(runId, checkpointId) {
  const safeId = safeSegment(checkpointId, "ckpt");
  return `${buildCheckpointDir(runId)}/${safeId}.json`;
}

function buildIndexPath(runId) {
  return `${buildCheckpointDir(runId)}/${INDEX_FILE}`;
}

function ensureVfs({ vfs, storageAdapter } = {}) {
  if (vfs && typeof vfs.writeFile === "function") return vfs;
  if (storageAdapter && typeof storageAdapter.get === "function") {
    try {
      return new StorageVfs(storageAdapter);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? "");
      logger.warn(`[checkpoint-store] Failed to build StorageVfs: ${msg}`);
    }
  }
  return null;
}

function makeCheckpointId() {
  try {
    return makeSecureTimestampedId("ckpt");
  } catch {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(16).slice(2, 10);
    return `ckpt_${ts}_${rand}`;
  }
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: "json_stringify_failed", message: msg });
  }
}

function bytesToText(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : bytes ? new Uint8Array(bytes) : new Uint8Array(0);
  return new TextDecoder().decode(view);
}

async function readText(vfs, path) {
  if (typeof vfs.readText === "function") return await vfs.readText(path);
  if (typeof vfs.readFile === "function") {
    const data = await vfs.readFile(path);
    if (typeof data === "string") return data;
    return bytesToText(data);
  }
  throw new Error("CheckpointStore: vfs.readText/readFile not available");
}

async function writeText(vfs, path, text) {
  if (typeof vfs.writeText === "function") return await vfs.writeText(path, text);
  if (typeof vfs.writeFile === "function") return await vfs.writeFile(path, text);
  throw new Error("CheckpointStore: vfs.writeText/writeFile not available");
}

async function loadIndex(vfs, runId) {
  const path = buildIndexPath(runId);
  try {
    const raw = await readText(vfs, path);
    const parsed = safeJsonParse(raw, { maxChars: 2_000_000 });
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.checkpoints)) {
      return parsed.checkpoints;
    }
    return [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err ?? "");
    if (!msg.includes("ENOENT") && !msg.includes("NotFound")) {
      logger.warn(`[checkpoint-store] Failed to read index: ${msg}`);
    }
    return [];
  }
}

async function saveIndex(vfs, runId, checkpoints) {
  const payload = {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    kind: INDEX_KIND,
    runId,
    updatedAt: new Date().toISOString(),
    checkpoints,
  };
  await writeText(vfs, buildIndexPath(runId), safeJsonStringify(payload));
}

/**
 * 校验 checkpoint 数据的最小 schema
 * @private
 * @param {unknown} data - 解析后的数据
 * @returns {object|null} 校验通过返回原对象，否则返回 null
 */
function validateCheckpoint(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const { schemaVersion, kind, checkpointId, runId } = data;
  // 必须包含核心字段且类型正确
  if (typeof schemaVersion !== "string") return null;
  if (typeof kind !== "string" || kind !== CHECKPOINT_KIND) return null;
  if (typeof checkpointId !== "string" || !checkpointId) return null;
  if (typeof runId !== "string" || !runId) return null;
  // metadata 必须是 plain object 或不存在
  if (data.metadata !== undefined && !isPlainObject(data.metadata)) return null;
  return data;
}

function normalizeRestoreMode(mode, { checkpointId, step } = {}) {
  const normalized = toNonEmptyString(mode)?.toLowerCase();
  if (normalized === "last" || normalized === "latest") return "last";
  if (normalized === "checkpoint" || normalized === "id") return "checkpoint";
  if (normalized === "step") return "step";
  if (checkpointId) return "checkpoint";
  if (step !== undefined && step !== null) return "step";
  return normalized || "last";
}

function normalizeIndexEntry(entry) {
  const e = entry && typeof entry === "object" ? entry : {};
  const checkpointId = toNonEmptyString(e.checkpointId);
  if (!checkpointId) return null;
  return {
    checkpointId,
    ts: toNonEmptyString(e.ts) || new Date().toISOString(),
    step: safeInt(e.step),
    iteration: safeInt(e.iteration),
    metadata: isPlainObject(e.metadata) ? e.metadata : undefined,
  };
}

/**
 * Agent 运行检查点存储
 *
 * 负责把一次运行的消息、工具调用、结果等快照写入 VFS，
 * 并维护索引以支持按"最新 / 指定 ID / 指定步数"恢复。
 *
 * @example
 * ```javascript
 * const store = new AgentCheckpointStore({ vfs, runId: 'session_123' });
 * const { checkpointId } = await store.saveCheckpoint({ messages, step: 12 });
 * const latest = await store.loadCheckpoint();
 * ```
 */
export class AgentCheckpointStore {
  /**
   * @param {object} options - 配置选项
   * @param {object} [options.vfs] - VFS 实例 (需要 readFile/writeFile 能力)
   * @param {object} [options.storageAdapter] - 存储适配器 (可替代 vfs)
   * @param {string} [options.runId] - 默认运行 ID
   * @param {object} [options.logger] - 自定义 logger
   */
  constructor({ vfs, storageAdapter, runId, logger: customLogger } = {}) {
    this._logger = customLogger || logger;
    this._vfs = ensureVfs({ vfs, storageAdapter });
    this._runId = toNonEmptyString(runId) || null;
  }

  get runId() {
    return this._runId;
  }

  set runId(value) {
    this._runId = toNonEmptyString(value) || null;
  }

  /**
   * @private
   * @returns {object} VFS 实例
   * @throws {Error} 如果未配置 vfs 或 storageAdapter
   */
  _requireVfs() {
    const vfs = this._vfs;
    if (!vfs) throw new Error("AgentCheckpointStore requires vfs or storageAdapter");
    return vfs;
  }

  /**
   * 列出指定运行的所有检查点
   * @param {object} [options] - 选项
   * @param {string} [options.runId] - 运行 ID (可选，默认使用实例 runId)
   * @returns {Promise<Array<{checkpointId: string, ts: string, step?: number, iteration?: number, metadata?: object}>>}
   */
  async listCheckpoints({ runId } = {}) {
    const id = toNonEmptyString(runId) || this._runId;
    if (!id) return [];
    const vfs = this._requireVfs();
    const index = await loadIndex(vfs, id);
    return index.map(normalizeIndexEntry).filter(Boolean);
  }

  /**
   * 保存检查点
   * @param {object} options - 检查点数据
   * @param {string} [options.runId] - 运行 ID (可选，默认使用实例 runId)
   * @param {Array} [options.messages] - 消息历史
   * @param {Array} [options.toolCalls] - 工具调用记录
   * @param {Array} [options.results] - 执行结果
   * @param {object} [options.metadata] - 元数据
   * @param {number} [options.step] - 步数
   * @param {number} [options.iteration] - 迭代次数
   * @returns {Promise<{checkpointId: string, checkpoint: object}>}
   * @throws {Error} 如果 runId 未指定
   */
  async saveCheckpoint({
    runId,
    messages,
    toolCalls,
    results,
    metadata,
    step,
    iteration,
  } = {}) {
    const id = toNonEmptyString(runId) || this._runId;
    if (!id) throw new Error("AgentCheckpointStore.saveCheckpoint: runId is required");
    const vfs = this._requireVfs();

    const checkpointId = makeCheckpointId();
    const ts = new Date().toISOString();
    const stepValue = safeInt(step) ?? safeInt(iteration) ?? null;
    const iterationValue = safeInt(iteration);

    const checkpoint = {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      kind: CHECKPOINT_KIND,
      checkpointId,
      runId: id,
      ts,
      step: stepValue,
      ...(iterationValue !== null ? { iteration: iterationValue } : {}),
      messages: Array.isArray(messages) ? messages : [],
      toolCalls: Array.isArray(toolCalls) ? toolCalls : [],
      results: Array.isArray(results) ? results : [],
      metadata: isPlainObject(metadata) ? metadata : {},
    };

    await writeText(vfs, buildCheckpointPath(id, checkpointId), safeJsonStringify(checkpoint));

    // 使用锁保护索引读写，防止并发竞态
    await withIndexLock(id, async () => {
      const index = await loadIndex(vfs, id);
      const entry = normalizeIndexEntry({
        checkpointId,
        ts,
        step: stepValue ?? undefined,
        iteration: iterationValue ?? undefined,
        metadata: checkpoint.metadata,
      });
      if (entry) index.push(entry);
      await saveIndex(vfs, id, index);
    });

    return { checkpointId, checkpoint };
  }

  /**
   * 加载检查点
   * @param {object} [options] - 选项
   * @param {string} [options.runId] - 运行 ID (可选，默认使用实例 runId)
   * @param {string} [options.checkpointId] - 指定检查点 ID
   * @param {number} [options.step] - 按步数匹配
   * @param {'last'|'checkpoint'|'step'} [options.mode] - 恢复模式 (默认 'last')
   * @returns {Promise<object|null>} 检查点数据，失败或未找到返回 null
   */
  async loadCheckpoint({ runId, checkpointId, step, mode } = {}) {
    const id = toNonEmptyString(runId) || this._runId;
    if (!id) return null;
    const vfs = this._requireVfs();

    const resolved = await this._resolveCheckpointId({
      runId: id,
      checkpointId,
      step,
      mode,
    });
    if (!resolved) return null;

    try {
      const raw = await readText(vfs, buildCheckpointPath(id, resolved));
      const parsed = safeJsonParse(raw, { maxChars: 5_000_000 });
      const validated = validateCheckpoint(parsed);
      if (!validated) {
        this._logger?.warn?.(`[checkpoint-store] Invalid checkpoint schema for ${resolved}`);
        return null;
      }
      return validated;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? "");
      this._logger?.warn?.(`[checkpoint-store] Failed to read checkpoint ${resolved}: ${msg}`);
      return null;
    }
  }

  /**
   * 解析检查点 ID
   * @private
   * @param {object} options - 选项
   * @param {string} [options.runId] - 运行 ID
   * @param {string} [options.checkpointId] - 检查点 ID
   * @param {number} [options.step] - 步数
   * @param {string} [options.mode] - 恢复模式
   * @returns {Promise<string|null>} 解析后的检查点 ID
   */
  async _resolveCheckpointId({ runId, checkpointId, step, mode } = {}) {
    const id = toNonEmptyString(runId) || this._runId;
    if (!id) return null;
    if (checkpointId) return toNonEmptyString(checkpointId) || null;

    const index = await this.listCheckpoints({ runId: id });
    if (index.length === 0) return null;

    const resolvedMode = normalizeRestoreMode(mode, { checkpointId, step });

    if (resolvedMode === "step") {
      const targetStep = safeInt(step);
      if (targetStep === null) return null;
      const match = index.find((entry) => safeInt(entry.step) === targetStep || safeInt(entry.iteration) === targetStep);
      return match?.checkpointId || null;
    }

    if (resolvedMode === "checkpoint") return toNonEmptyString(checkpointId) || null;

    return index[index.length - 1]?.checkpointId || null;
  }
}

export default AgentCheckpointStore;
