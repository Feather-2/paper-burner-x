/**
 * VFS Bridge for Pyodide
 * 
 * 实现 Pyodide (Emscripten MEMFS) 与项目内核 VFS (OPFS/Memory) 的桥接。
 * 主要策略：
 * 1. 挂载：在 Python Worker 启动时，将内核 VFS 的快照同步到 Pyodide。
 * 2. 同步：执行完成后，将 Pyodide 的变更回写到内核 VFS。
 */

export class PyodideVFSBridge {
  /**
   * @param {Object} kernelVfs - 内核 VFS 实例 (js/agents/vfs/index.js)
   * @param {Object} pyodideInstance - Pyodide 实例
   */
  constructor(kernelVfs, pyodideInstance) {
    this.vfs = kernelVfs;
    this.pyodide = pyodideInstance;
    this.mountedPaths = new Set();
  }

  /**
   * 将内核 VFS 的目录同步到 Pyodide
   * @param {string} remotePath - 内核 VFS 路径
   * @param {string} localPath - Pyodide 内部路径
   */
  async mount(remotePath, localPath) {
    // 1. 在 Pyodide 中创建目录
    this.pyodide.FS.mkdirTree(localPath);
    
    // 2. 递归读取内核 VFS 并写入 Pyodide
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

  async _syncFromKernel(remotePath, localPath) {
    const entries = await this.vfs.list(remotePath);
    for (const entry of entries) {
      const remoteEntryPath = `${remotePath}/${entry.name}`;
      const localEntryPath = `${localPath}/${entry.name}`;
      
      if (entry.kind === 'directory') {
        this.pyodide.FS.mkdir(localEntryPath);
        await this._syncFromKernel(remoteEntryPath, localEntryPath);
      } else {
        const content = await this.vfs.readFile(remoteEntryPath);
        this.pyodide.FS.writeFile(localEntryPath, content);
      }
    }
  }

  async _syncToKernel(localPath, remotePath) {
    // 简单实现：全量覆盖或基于时间戳/MD5的增量同步
    // 注意：Pyodide FS.readdir 会返回 . 和 ..
    const entries = this.pyodide.FS.readdir(localPath).filter(e => e !== '.' && e !== '..');
    
    for (const name of entries) {
      const localEntryPath = `${localPath}/${name}`;
      const remoteEntryPath = `${remotePath}/${name}`;
      const stat = this.pyodide.FS.stat(localEntryPath);
      
      if (this.pyodide.FS.isDir(stat.mode)) {
        await this.vfs.mkdir(remoteEntryPath);
        await this._syncToKernel(localEntryPath, remoteEntryPath);
      } else {
        const content = this.pyodide.FS.readFile(localEntryPath);
        await this.vfs.writeFile(remoteEntryPath, content);
      }
    }
  }
}
