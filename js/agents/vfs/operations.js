import { normalizeVfsPath } from "./path.js";
import { recordVfsCheckpoint } from "./checkpoints.js";
import { cryptoRandomHex } from "../shared/index.js";

import { isPlainObject } from "../shared/index.js";
// ─────────────────────────────────────────────────────────────────────────────
// Per-path async locking (browser-safe)
//
// In browser mode, agents may issue parallel tool calls that write the same file.
// OPFS / Memory backends are not transactional; serialize writes per (vfs,path).
// ─────────────────────────────────────────────────────────────────────────────

const _locksByVfs = new WeakMap(); // vfs -> Map<path, Promise>

/**
 * @typedef {{ signal?: AbortSignal }} AbortOptions
 */

function getLockMapForVfs(vfs) {
  if (!vfs || typeof vfs !== "object") return null;
  let map = _locksByVfs.get(vfs);
  if (!map) {
    map = new Map();
    _locksByVfs.set(vfs, map);
  }
  return map;
}

/**
 * @template T
 * @param {Promise<T>|T} promise
 * @param {AbortOptions} [options]
 * @returns {Promise<T>}
 */
async function waitFor(promise, { signal } = {}) {
  /** @type {unknown} */
  const maybeThenable = promise;
  const p =
    maybeThenable !== null &&
    maybeThenable !== undefined &&
    (typeof maybeThenable === "object" || typeof maybeThenable === "function") &&
    typeof /** @type {{ then?: unknown }} */ (maybeThenable).then === "function"
      ? /** @type {PromiseLike<T>} */ (maybeThenable)
      : Promise.resolve(promise);
  if (!signal) return await p;
  if (signal.aborted) throw new Error(typeof signal.reason === "string" ? signal.reason : "aborted");

  let onAbort = null;
  const abortPromise = new Promise((_, reject) => {
    onAbort = () => reject(new Error(typeof signal.reason === "string" ? signal.reason : "aborted"));
    signal.addEventListener?.("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([p, abortPromise]);
  } finally {
    try {
      if (onAbort) signal.removeEventListener?.("abort", onAbort);
    } catch {
      // ignore
    }
  }
}

/**
 * @template T
 * @param {any} vfs
 * @param {string} path
 * @param {() => Promise<T>} fn
 * @param {AbortOptions} [options]
 * @returns {Promise<T>}
 */
async function withVfsPathLock(vfs, path, fn, { signal } = {}) {
  const lockMap = getLockMapForVfs(vfs);
  if (!lockMap) return await fn();
  const key = String(path || "");
  if (!key) return await fn();

  const prevTail = lockMap.get(key) || Promise.resolve();
  /** @type {(() => void) | null} */
  let release = null;
  const tail = new Promise((resolve) => {
    release = () => resolve();
  });
  lockMap.set(key, tail);

  try {
    await waitFor(prevTail, { signal });
    return await fn();
  } finally {
    try {
      release?.();
    } catch {
      // ignore
    }
    if (lockMap.get(key) === tail) {
      lockMap.delete(key);
    }
  }
}

async function safeReadText(vfs, path) {
  try {
    if (typeof vfs.readText === "function") return await vfs.readText(path);
    const bytes = await vfs.readFile(path);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

async function removeVfsPath(vfs, path) {
  if (!vfs || typeof vfs !== "object") return false;
  if (typeof vfs.delete === "function") {
    await vfs.delete(path);
    return true;
  }
  if (typeof vfs.unlink === "function") {
    await vfs.unlink(path);
    return true;
  }
  if (typeof vfs.rm === "function") {
    await vfs.rm(path);
    return true;
  }
  return false;
}

function getEmitFn(stageApi) {
  const emit = stageApi?.emit || stageApi?.eventBus?.emit;
  return typeof emit === "function" ? emit : null;
}

function normalizeEditOperation(edit, index) {
  const op = edit && typeof edit === "object" ? edit : {};
  const oldString = typeof op.old_string === "string" ? op.old_string : typeof op.oldString === "string" ? op.oldString : "";
  const newString = typeof op.new_string === "string" ? op.new_string : typeof op.newString === "string" ? op.newString : "";

  if (!oldString) {
    throw new Error(`multi_edit: edits[${index}].old_string must be a non-empty string`);
  }
  if (oldString === newString) {
    throw new Error(`multi_edit: edits[${index}] old_string equals new_string (no-op)`);
  }

  return { oldString, newString };
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let start = 0;
  while (start <= haystack.length) {
    const idx = haystack.indexOf(needle, start);
    if (idx === -1) break;
    count += 1;
    start = idx + needle.length;
  }
  return count;
}

function splitLinesWithStarts(text) {
  const s = typeof text === "string" ? text : String(text ?? "");
  const starts = [0];
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === "\n") starts.push(i + 1);
  }
  const lines = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const endExclusive = i + 1 < starts.length ? starts[i + 1] : s.length;
    const end = endExclusive > start ? endExclusive - 1 : start; // exclude '\n'
    lines.push(s.slice(start, end));
  }
  return { text: s, starts, lines };
}

function normalizeBlockText(text) {
  const raw = typeof text === "string" ? text : String(text ?? "");
  const lines = raw.split("\n").map((line) => String(line ?? "").trimEnd());

  // Trim empty lines at edges (common when callers include a trailing newline).
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start += 1;
  while (end > start && lines[end - 1].trim() === "") end -= 1;
  const body = lines.slice(start, end);
  if (body.length === 0) return "";

  // Normalize indentation: remove common leading whitespace across non-empty lines.
  let minIndent = Infinity;
  for (const line of body) {
    if (!line.trim()) continue;
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (ch !== " " && ch !== "\t") break;
      i += 1;
    }
    minIndent = Math.min(minIndent, i);
  }
  if (!Number.isFinite(minIndent) || minIndent === Infinity) minIndent = 0;

  const normalized = body.map((line) => (minIndent ? line.slice(Math.min(minIndent, line.length)) : line));
  return normalized.join("\n");
}

function findUniqueNormalizedBlockMatch(fileIndex, needleText) {
  const idx = fileIndex && typeof fileIndex === "object" ? fileIndex : null;
  const haystackText = typeof idx?.text === "string" ? idx.text : "";
  const haystackLines = Array.isArray(idx?.lines) ? idx.lines : [];
  const haystackStarts = Array.isArray(idx?.starts) ? idx.starts : [];

  const needleNorm = normalizeBlockText(needleText);
  if (!needleNorm) return null;

  const needleLines = needleNorm.split("\n");
  const firstAnchor = needleLines[0]?.trim() || "";
  const lastAnchor = needleLines[needleLines.length - 1]?.trim() || "";
  if (!firstAnchor) return null;

  const startIndices = [];
  for (let i = 0; i < haystackLines.length; i += 1) {
    if (haystackLines[i].trim() === firstAnchor) startIndices.push(i);
  }
  if (startIndices.length === 0) return null;

  const matches = [];
  const expectedLines = needleLines.length;
  const maxSlack = Math.min(60, Math.max(6, Math.floor(expectedLines * 0.6)));

  for (const startLine of startIndices) {
    const maxEnd = Math.min(haystackLines.length - 1, startLine + expectedLines + maxSlack);
    for (let endLine = startLine; endLine <= maxEnd; endLine += 1) {
      if (lastAnchor && haystackLines[endLine].trim() !== lastAnchor) continue;

      const startOffset = haystackStarts[startLine] ?? 0;
      const endOffsetExclusive = endLine + 1 < haystackStarts.length ? haystackStarts[endLine + 1] : haystackText.length;
      const candidate = haystackText.slice(startOffset, endOffsetExclusive);
      const candidateNorm = normalizeBlockText(candidate);
      if (candidateNorm !== needleNorm) continue;

      matches.push({ start: startOffset, end: endOffsetExclusive, matched: candidate });
      if (matches.length > 1) return null; // ambiguous
      break; // for this startLine
    }
  }

  return matches.length === 1 ? matches[0] : null;
}

function detectEditConflicts(editPositions) {
  const conflicts = [];
  const list = Array.isArray(editPositions) ? editPositions : [];

  const ranges = list
    .map((e) => ({ index: e.index, start: e.start, end: e.end }))
    .sort((a, b) => a.start - b.start);

  for (let i = 1; i < ranges.length; i += 1) {
    const prev = ranges[i - 1];
    const cur = ranges[i];
    if (cur.start < prev.end) {
      conflicts.push({
        edit1Index: prev.index,
        edit2Index: cur.index,
        description: `Edits ${prev.index + 1} and ${cur.index + 1} overlap (positions ${prev.start}-${prev.end} and ${cur.start}-${cur.end})`,
      });
    }
  }

  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      if (a.newString.includes(b.oldString)) {
        conflicts.push({
          edit1Index: a.index,
          edit2Index: b.index,
          description: `Edit ${a.index + 1}'s new_string contains Edit ${b.index + 1}'s old_string`,
        });
      }
      if (b.newString.includes(a.oldString)) {
        conflicts.push({
          edit1Index: b.index,
          edit2Index: a.index,
          description: `Edit ${b.index + 1}'s new_string contains Edit ${a.index + 1}'s old_string`,
        });
      }
    }
  }

  return conflicts;
}

function applyEditsByPositions(originalText, editPositions) {
  const list = Array.isArray(editPositions) ? editPositions : [];
  const sorted = list.slice().sort((a, b) => b.start - a.start);
  let out = originalText;
  for (const edit of sorted) {
    out = out.slice(0, edit.start) + edit.newString + out.slice(edit.end);
  }
  return out;
}

/**
 * @typedef {object} WriteTextFileWithPolicyOptions
 * @property {any=} vfs
 * @property {string=} path
 * @property {string=} text
 * @property {{ authorize?: (request: any, context?: any) => Promise<any> }=} policy
 * @property {any=} runStore
 * @property {string=} runId
 * @property {{ emit?: Function, eventBus?: { emit?: Function }, signal?: AbortSignal, storageAdapter?: any }=} stageApi
 * @property {AbortSignal=} signal
 * @property {boolean=} checkpoint
 */

/**
 * @param {WriteTextFileWithPolicyOptions} [options]
 * @returns {Promise<{ ok: boolean, path: string, checkpoint?: { artifactId: string, type: string }, noOp?: boolean }>}
 */
export async function writeTextFileWithPolicy({
  vfs,
  path,
  text,
  policy,
  runStore,
  runId,
  stageApi,
  signal,
  checkpoint = true,
} = {}) {
  if (!vfs || typeof vfs.writeText !== "function") throw new Error("writeTextFileWithPolicy: vfs.writeText is required");
  const normalizedPath = normalizeVfsPath(path);
  if (!normalizedPath) throw new Error("writeTextFileWithPolicy: path must be a non-empty VFS path");

  const content = typeof text === "string" ? text : String(text ?? "");

  return await withVfsPathLock(
    vfs,
    normalizedPath,
    async () => {
      const approval = policy && typeof policy.authorize === "function"
        ? await policy.authorize(
          {
            type: "vfs.write",
            tool: "vfs.writeText",
            resource: normalizedPath,
            args: { path: normalizedPath, bytes: content.length },
          },
          { signal: signal || stageApi?.signal }
        )
        : { allowed: true };

      if (approval?.allowed === false) {
        const reason = typeof approval.reason === "string" ? approval.reason : "denied";
        throw new Error(`Policy denied: ${reason}`);
      }

      const before = await safeReadText(vfs, normalizedPath);
      await vfs.writeText(normalizedPath, content);

      let checkpointRef = null;
      const storageAdapter = stageApi?.storageAdapter || vfs?.storageAdapter || null;
      if (checkpoint && runId && (runStore || storageAdapter)) {
        try {
          const after = content;
          const saved = await recordVfsCheckpoint({
            runStore,
            storageAdapter,
            runId,
            path: normalizedPath,
            before: before ?? "",
            after,
            op: "writeText",
          });
          checkpointRef = { artifactId: saved.artifactId, type: "vfs_checkpoint.json" };
        } catch {
          // ignore checkpoint failures
        }
      }

      const emit = getEmitFn(stageApi);
      emit?.("vfs:write:completed", {
        path: normalizedPath,
        bytes: content.length,
        ...(checkpointRef ? { checkpoint: checkpointRef } : {}),
        ...(approval && isPlainObject(approval) ? { policy: approval } : {}),
      });

      return { ok: true, path: normalizedPath, ...(checkpointRef ? { checkpoint: checkpointRef } : {}) };
    },
    { signal: signal || stageApi?.signal }
  );
}

/**
 * @typedef {object} MultiEditTextFileWithPolicyOptions
 * @property {any=} vfs
 * @property {string=} path
 * @property {Array<{ old_string?: string, new_string?: string, oldString?: string, newString?: string }>=} edits
 * @property {{ authorize?: (request: any, context?: any) => Promise<any> }=} policy
 * @property {any=} runStore
 * @property {string=} runId
 * @property {{ emit?: Function, eventBus?: { emit?: Function }, signal?: AbortSignal, storageAdapter?: any }=} stageApi
 * @property {AbortSignal=} signal
 * @property {boolean=} checkpoint
 */

/**
 * @param {MultiEditTextFileWithPolicyOptions} [options]
 * @returns {Promise<{ ok: boolean, path: string, checkpoint?: { artifactId: string, type: string }, noOp?: boolean }>}
 */
export async function multiEditTextFileWithPolicy({
  vfs,
  path,
  edits,
  policy,
  runStore,
  runId,
  stageApi,
  signal,
  checkpoint = true,
} = {}) {
  if (!vfs || typeof vfs.writeText !== "function") throw new Error("multiEditTextFileWithPolicy: vfs.writeText is required");
  const normalizedPath = normalizeVfsPath(path);
  if (!normalizedPath) throw new Error("multiEditTextFileWithPolicy: path must be a non-empty VFS path");

  const rawEdits = Array.isArray(edits) ? edits : [];
  if (rawEdits.length === 0) throw new Error("multiEditTextFileWithPolicy: edits must be a non-empty array");

  return await withVfsPathLock(
    vfs,
    normalizedPath,
    async () => {
      const before = await safeReadText(vfs, normalizedPath);
      if (before === null) throw new Error(`multiEditTextFileWithPolicy: file not found: ${normalizedPath}`);

      const normalizedEdits = [];
      const seenOld = new Set();
      for (let i = 0; i < rawEdits.length; i += 1) {
        const { oldString, newString } = normalizeEditOperation(rawEdits[i], i);
        if (seenOld.has(oldString)) throw new Error(`multi_edit: duplicate old_string in edits[${i}]`);
        seenOld.add(oldString);
        normalizedEdits.push({ index: i, oldString, newString });
      }

      const positions = [];
      let fileIndex = null;
      const getFileIndex = () => {
        if (fileIndex) return fileIndex;
        fileIndex = splitLinesWithStarts(before);
        return fileIndex;
      };
      for (const edit of normalizedEdits) {
        const occurrences = countOccurrences(before, edit.oldString);
        if (occurrences === 1) {
          const start = before.indexOf(edit.oldString);
          const end = start + edit.oldString.length;
          positions.push({ ...edit, start, end });
          continue;
        }

        // Robust fallback: allow whitespace/indentation-normalized block matching when exact match fails/ambiguous.
        const normalizedMatch = findUniqueNormalizedBlockMatch(getFileIndex(), edit.oldString);
        if (normalizedMatch) {
          positions.push({ ...edit, start: normalizedMatch.start, end: normalizedMatch.end });
          continue;
        }

        if (occurrences === 0) {
          throw new Error(
            `multi_edit: edits[${edit.index}].old_string not found (exact), and no unique whitespace/indentation-normalized match was found`
          );
        }
        throw new Error(
          `multi_edit: edits[${edit.index}].old_string found ${occurrences} times (must be unique), and no unique whitespace/indentation-normalized match was found`
        );
      }

      const conflicts = detectEditConflicts(positions);
      if (conflicts.length > 0) {
        const lines = conflicts.map((c) => `- ${c.description}`).join("\n");
        throw new Error(`multi_edit: detected ${conflicts.length} conflict(s):\n${lines}`);
      }

      const after = applyEditsByPositions(before, positions);
      if (after === before) {
        return { ok: true, path: normalizedPath, noOp: true };
      }

      const approval = policy && typeof policy.authorize === "function"
        ? await policy.authorize(
          {
            type: "vfs.write",
            tool: "vfs.multiEdit",
            resource: normalizedPath,
            args: { path: normalizedPath, edits: normalizedEdits.length, bytes: after.length },
          },
          { signal: signal || stageApi?.signal }
        )
        : { allowed: true };

      if (approval?.allowed === false) {
        const reason = typeof approval.reason === "string" ? approval.reason : "denied";
        throw new Error(`Policy denied: ${reason}`);
      }

      try {
        await vfs.writeText(normalizedPath, after);
      } catch (err) {
        try {
          await vfs.writeText(normalizedPath, before);
        } catch {
          // ignore rollback failures
        }
        throw err;
      }

      let checkpointRef = null;
      const storageAdapter = stageApi?.storageAdapter || vfs?.storageAdapter || null;
      if (checkpoint && runId && (runStore || storageAdapter)) {
        try {
          const saved = await recordVfsCheckpoint({
            runStore,
            storageAdapter,
            runId,
            path: normalizedPath,
            before,
            after,
            op: "multi_edit",
          });
          checkpointRef = { artifactId: saved.artifactId, type: "vfs_checkpoint.json" };
        } catch {
          // ignore checkpoint failures
        }
      }

      const emit = getEmitFn(stageApi);
      emit?.("vfs:write:completed", {
        path: normalizedPath,
        bytes: after.length,
        ...(checkpointRef ? { checkpoint: checkpointRef } : {}),
        ...(approval && isPlainObject(approval) ? { policy: approval } : {}),
      });

      return { ok: true, path: normalizedPath, ...(checkpointRef ? { checkpoint: checkpointRef } : {}) };
    },
    { signal: signal || stageApi?.signal }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// P0.3: 原子化文件写入
//
// 使用 write-to-tmp-then-rename 模式，确保写入中断不会损坏现有文件。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 生成临时文件名
 */
function generateTempFileName(path) {
  const ts = Date.now().toString(36);
  const rand = cryptoRandomHex(3);
  return `${path}.tmp_${ts}_${rand}`;
}

/**
 * 原子化写入文本文件
 *
 * 策略：
 * 1. 写入临时文件 (path.tmp_xxx)
 * 2. 验证临时文件内容
 * 3. 重命名临时文件覆盖目标文件
 * 4. 如果任何步骤失败，清理临时文件
 *
 * @param {object} vfs - VFS 实例
 * @param {string} path - 目标文件路径
 * @param {string} content - 文件内容
 * @param {object} [options]
 * @param {boolean} [options.verify=true] - 是否验证写入内容
 * @param {AbortSignal} [options.signal] - 取消信号
 * @returns {Promise<{ok: boolean, path: string, tempPath?: string, error?: string}>}
 */
async function atomicWriteText(vfs, path, content, { verify = true, signal } = {}) {
  const normalizedPath = normalizeVfsPath(path);
  const tempPath = generateTempFileName(normalizedPath);

  // 检查取消
  const checkCancelled = () => {
    if (signal?.aborted) {
      throw new Error(typeof signal.reason === "string" ? signal.reason : "aborted");
    }
  };

  return withVfsPathLock(
    vfs,
    normalizedPath,
    async () => {
      checkCancelled();

      let tempWritten = false;

      try {
        // Step 1: 写入临时文件
        await vfs.writeText(tempPath, content);
        tempWritten = true;
        checkCancelled();

        // Step 2: 验证写入内容
        if (verify) {
          const written = await safeReadText(vfs, tempPath);
          if (written !== content) {
            throw new Error("atomicWrite: verification failed - content mismatch");
          }
        }
        checkCancelled();

        // Step 3: 重命名临时文件
        // 尝试使用 rename（如果 VFS 支持）
        if (typeof vfs.rename === "function") {
          await vfs.rename(tempPath, normalizedPath);
        } else {
          // 降级：直接覆盖写入，避免“先删后写”导致的数据丢失窗口
          // 注意：无 rename 支持时依然不是严格原子写入（进程崩溃时可能出现部分写入）
          await vfs.writeText(normalizedPath, content);
          // 清理临时文件
          try {
            await removeVfsPath(vfs, tempPath);
          } catch {
            // 忽略清理错误
          }
        }

        return { ok: true, path: normalizedPath };
      } catch (err) {
        // 清理临时文件
        if (tempWritten) {
          try {
            await removeVfsPath(vfs, tempPath);
          } catch {
            // 忽略清理错误
          }
        }

        return {
          ok: false,
          path: normalizedPath,
          tempPath,
          error: String(err?.message || err),
        };
      }
    },
    { signal }
  );
}

/**
 * 原子化写入二进制文件
 *
 * @param {object} vfs - VFS 实例
 * @param {string} path - 目标文件路径
 * @param {Uint8Array|ArrayBuffer} data - 文件数据
 * @param {object} [options]
 * @param {boolean} [options.verify=true] - 是否验证写入内容
 * @param {AbortSignal} [options.signal] - 取消信号
 * @returns {Promise<{ok: boolean, path: string, tempPath?: string, error?: string}>}
 */
async function atomicWriteFile(vfs, path, data, { verify = true, signal } = {}) {
  const normalizedPath = normalizeVfsPath(path);
  const tempPath = generateTempFileName(normalizedPath);

  const bytes = data instanceof Uint8Array
    ? data
    : data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(0);

  const checkCancelled = () => {
    if (signal?.aborted) {
      throw new Error(typeof signal.reason === "string" ? signal.reason : "aborted");
    }
  };

  return withVfsPathLock(
    vfs,
    normalizedPath,
    async () => {
      checkCancelled();

      let tempWritten = false;

      try {
        // Step 1: 写入临时文件
        await vfs.writeFile(tempPath, bytes);
        tempWritten = true;
        checkCancelled();

        // Step 2: 验证写入内容
        if (verify) {
          const written = await vfs.readFile(tempPath);
          if (written.length !== bytes.length) {
            throw new Error("atomicWrite: verification failed - size mismatch");
          }
          // 快速校验前后部分
          const checkSize = Math.min(1024, bytes.length);
          for (let i = 0; i < checkSize; i++) {
            if (written[i] !== bytes[i]) {
              throw new Error("atomicWrite: verification failed - content mismatch at start");
            }
          }
          if (bytes.length > checkSize) {
            for (let i = bytes.length - checkSize; i < bytes.length; i++) {
              if (written[i] !== bytes[i]) {
                throw new Error("atomicWrite: verification failed - content mismatch at end");
              }
            }
          }
        }
        checkCancelled();

        // Step 3: 重命名临时文件
        if (typeof vfs.rename === "function") {
          await vfs.rename(tempPath, normalizedPath);
        } else {
          try {
            const exists = typeof vfs.exists === "function" ? await vfs.exists(normalizedPath) : true;
            if (exists) await removeVfsPath(vfs, normalizedPath);
          } catch {
            // 忽略删除错误
          }
          await vfs.writeFile(normalizedPath, bytes);
          try {
            await removeVfsPath(vfs, tempPath);
          } catch {
            // 忽略清理错误
          }
        }

        return { ok: true, path: normalizedPath };
      } catch (err) {
        if (tempWritten) {
          try {
            await removeVfsPath(vfs, tempPath);
          } catch {
            // 忽略清理错误
          }
        }

        return {
          ok: false,
          path: normalizedPath,
          tempPath,
          error: String(err?.message || err),
        };
      }
    },
    { signal }
  );
}

/**
 * 便捷函数：原子化写入（自动检测类型）
 */
async function atomicWrite(vfs, path, data, options = {}) {
  if (typeof data === "string") {
    return atomicWriteText(vfs, path, data, options);
  }
  return atomicWriteFile(vfs, path, data, options);
}

export {
  atomicWrite,
  atomicWriteText,
  atomicWriteFile,
};

export default { writeTextFileWithPolicy, multiEditTextFileWithPolicy, atomicWrite, atomicWriteText, atomicWriteFile };
