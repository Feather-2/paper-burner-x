/**
 * VFS Bridge for Pyodide
 *
 * 实现 Pyodide (Emscripten MEMFS) 与项目内核 VFS (OPFS/Memory) 的桥接。
 * 主要策略：
 * 1. 挂载：在 Python Worker 启动时，将内核 VFS 的快照同步到 Pyodide。
 * 2. 同步：执行完成后，将 Pyodide 的变更回写到内核 VFS。
 */

const DEFAULT_CONCURRENCY = 8;

export class PyodideVFSBridge {
  /**
   * @param {Object} kernelVfs - 内核 VFS 实例 (js/agents/vfs/index.js)
   * @param {Object} pyodideInstance - Pyodide 实例
   * @param {Object} [options]
   * @param {number} [options.concurrency=8] - 并发 I/O 数
   */
  constructor(kernelVfs, pyodideInstance, options = {}) {
    this.vfs = kernelVfs;
    this.pyodide = pyodideInstance;
    this.mountedPaths = new Set();
    this._concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  }

  /**
   * 将内核 VFS 的目录同步到 Pyodide
   * @param {string} remotePath - 内核 VFS 路径
   * @param {string} localPath - Pyodide 内部路径
   */
  async mount(remotePath, localPath) {
    this.pyodide.FS.mkdirTree(localPath);
    await this._syncFromKernel(remotePath, localPath);
    this.mountedPaths.add({ remotePath, localPath });
  }

  /**
   * 将 Pyodide 的变更同步回内核 VFS
   */
  async syncBack() {
    for (const { remotePath, localPath } of this.mountedPaths) {
      await this._syncToKernel(localPath, remotePath);
    }
  }

  /**
   * 批量并发执行任务（控制并发数）
   */
  async _runBatch(tasks, fn) {
    const results = [];
    for (let i = 0; i < tasks.length; i += this._concurrency) {
      const batch = tasks.slice(i, i + this._concurrency);
      const batchResults = await Promise.all(batch.map(fn));
      results.push(...batchResults);
    }
    return results;
  }

  /**
   * 递归收集所有文件和目录（不执行 I/O）
   */
  async _collectEntries(remotePath) {
    const entries = [];
    const stack = [{ remotePath, depth: 0 }];

    while (stack.length > 0) {
      const { remotePath: currentPath, depth } = stack.pop();
      const items = await this.vfs.list(currentPath);

      for (const entry of items) {
        const entryPath = `${currentPath}/${entry.name}`;
        entries.push({ path: entryPath, kind: entry.kind, depth });
        if (entry.kind === "directory") {
          stack.push({ remotePath: entryPath, depth: depth + 1 });
        }
      }
    }

    // 按深度排序，确保父目录先创建
    entries.sort((a, b) => a.depth - b.depth);
    return entries;
  }

  async _syncFromKernel(remotePath, localPath) {
    // 1. 收集所有条目
    const entries = await this._collectEntries(remotePath);
    const prefixLen = remotePath.length;

    // 2. 创建所有目录
    for (const entry of entries) {
      if (entry.kind === "directory") {
        const relativePath = entry.path.slice(prefixLen);
        const targetPath = localPath + relativePath;
        try {
          this.pyodide.FS.mkdir(targetPath);
        } catch {
          // 目录可能已存在
        }
      }
    }

    // 3. 批量并发读取并写入文件
    const files = entries.filter((e) => e.kind !== "directory");
    await this._runBatch(files, async (entry) => {
      const relativePath = entry.path.slice(prefixLen);
      const targetPath = localPath + relativePath;
      const content = await this.vfs.readFile(entry.path);
      this.pyodide.FS.writeFile(targetPath, content);
    });
  }

  /**
   * 递归收集 Pyodide FS 中的所有条目
   */
  _collectPyodideEntries(localPath) {
    const entries = [];
    const stack = [{ localPath, depth: 0 }];

    while (stack.length > 0) {
      const { localPath: currentPath, depth } = stack.pop();
      const items = this.pyodide.FS.readdir(currentPath).filter((e) => e !== "." && e !== "..");

      for (const name of items) {
        const entryPath = `${currentPath}/${name}`;
        const stat = this.pyodide.FS.stat(entryPath);
        const isDir = this.pyodide.FS.isDir(stat.mode);
        entries.push({ path: entryPath, isDir, depth });
        if (isDir) {
          stack.push({ localPath: entryPath, depth: depth + 1 });
        }
      }
    }

    entries.sort((a, b) => a.depth - b.depth);
    return entries;
  }

  async _syncToKernel(localPath, remotePath) {
    // 1. 收集所有条目
    const entries = this._collectPyodideEntries(localPath);
    const prefixLen = localPath.length;

    // 2. 创建所有目录
    for (const entry of entries) {
      if (entry.isDir) {
        const relativePath = entry.path.slice(prefixLen);
        const targetPath = remotePath + relativePath;
        await this.vfs.mkdir(targetPath);
      }
    }

    // 3. 批量并发写入文件
    const files = entries.filter((e) => !e.isDir);
    await this._runBatch(files, async (entry) => {
      const relativePath = entry.path.slice(prefixLen);
      const targetPath = remotePath + relativePath;
      const content = this.pyodide.FS.readFile(entry.path);
      await this.vfs.writeFile(targetPath, content);
    });
  }
}
