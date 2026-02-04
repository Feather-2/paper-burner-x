/**
 * VFS Scan Worker - OPFS 文件扫描 Worker
 *
 * 将 OPFS 目录遍历移出主线程，避免 UI 阻塞。
 * 支持增量返回（streaming）和取消操作。
 */

/**
 * 消息协议：
 *
 * 请求：
 * { type: "scan", id, rootDirName, prefix, recursive, maxFiles }
 * { type: "cancel", id }
 *
 * 响应：
 * { type: "progress", id, files: string[], done: false }
 * { type: "result", id, files: string[], done: true }
 * { type: "error", id, error: string }
 * { type: "cancelled", id }
 */

/**
 * @typedef {object} ScanRequestMessage
 * @property {"scan"} type
 * @property {string} id
 * @property {string=} rootDirName
 * @property {string=} prefix
 * @property {boolean=} recursive
 * @property {number=} maxFiles
 */

/**
 * @typedef {object} CancelRequestMessage
 * @property {"cancel"} type
 * @property {string} id
 */

/**
 * @typedef {ScanRequestMessage | CancelRequestMessage} ScanWorkerRequestMessage
 */

/**
 * @typedef {object} ScanProgressMessage
 * @property {"progress"} type
 * @property {string} id
 * @property {string[]} files
 * @property {number=} total
 * @property {false} done
 */

/**
 * @typedef {object} ScanResultMessage
 * @property {"result"} type
 * @property {string} id
 * @property {string[]} files
 * @property {number} total
 * @property {true} done
 */

/**
 * @typedef {object} ScanErrorMessage
 * @property {"error"} type
 * @property {string} id
 * @property {string} error
 */

/**
 * @typedef {object} ScanCancelledMessage
 * @property {"cancelled"} type
 * @property {string} id
 */

/**
 * @typedef {ScanProgressMessage | ScanResultMessage | ScanErrorMessage | ScanCancelledMessage} ScanWorkerResponseMessage
 */

const activeTasks = new Map(); // id -> { aborted: boolean }

async function scanOpfs(id, { rootDirName, prefix, recursive, maxFiles }) {
  const task = { aborted: false };
  activeTasks.set(id, task);

  try {
    if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) {
      throw new Error("OPFS not available in worker");
    }

    const storageRoot = await navigator.storage.getDirectory();
    const root = rootDirName
      ? await storageRoot.getDirectoryHandle(String(rootDirName), { create: false })
      : storageRoot;

    // 获取起始目录
    let startDir = root;
    const prefixPath = String(prefix || "").replace(/\\/g, "/").split("/").filter(Boolean);
    for (const seg of prefixPath) {
      startDir = await startDir.getDirectoryHandle(seg, { create: false });
    }

    const files = [];
    const BATCH_SIZE = 500; // 每批返回的文件数

    async function walk(dirHandle, dirPath) {
      if (task.aborted) return;
      if (maxFiles > 0 && files.length >= maxFiles) return;

      const entries = [];
      for await (const entry of dirHandle.entries()) {
        if (task.aborted) return;
        entries.push(entry);
      }

      // 排序保证一致性
      entries.sort((a, b) => String(a[0]).localeCompare(String(b[0])));

      for (const [name, handle] of entries) {
        if (task.aborted) return;
        if (maxFiles > 0 && files.length >= maxFiles) return;

        if (handle.kind === "directory") {
          if (recursive !== false) {
            const nextPath = dirPath ? `${dirPath}/${name}` : name;
            await walk(handle, nextPath);
          }
          continue;
        }

        const filePath = dirPath ? `${dirPath}/${name}` : name;
        files.push(filePath);

        // 增量返回
        if (files.length % BATCH_SIZE === 0) {
          self.postMessage({
            type: "progress",
            id,
            files: files.slice(-BATCH_SIZE),
            total: files.length,
            done: false,
          });
        }
      }
    }

    const basePath = prefixPath.join("/");
    await walk(startDir, basePath);

    if (task.aborted) {
      self.postMessage({ type: "cancelled", id });
    } else {
      // 返回最终结果
      self.postMessage({
        type: "result",
        id,
        files,
        total: files.length,
        done: true,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("NotFoundError") || msg.includes("not found")) {
      // 目录不存在，返回空
      self.postMessage({ type: "result", id, files: [], total: 0, done: true });
    } else {
      self.postMessage({ type: "error", id, error: msg });
    }
  } finally {
    activeTasks.delete(id);
  }
}

function cancelTask(id) {
  const task = activeTasks.get(id);
  if (task) {
    task.aborted = true;
  }
}

// @ts-ignore - Worker self.onmessage type differs from Window.onmessage
/** @type {(event: MessageEvent<ScanWorkerRequestMessage>) => void} */
self.onmessage = (event) => {
  const msg = event?.data;
  if (!msg || typeof msg !== "object") return;

  const { type, id } = msg;

  switch (type) {
    case "scan":
      scanOpfs(id, {
        rootDirName: msg.rootDirName,
        prefix: msg.prefix,
        recursive: msg.recursive,
        maxFiles: msg.maxFiles || 0,
      });
      break;

    case "cancel":
      cancelTask(id);
      break;

    default:
      self.postMessage(/** @type {ScanWorkerResponseMessage} */ ({ type: "error", id, error: `Unknown message type: ${type}` }));
  }
};
