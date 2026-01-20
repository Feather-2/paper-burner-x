# Audit History - vfs

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] cross-backend-consistency
*Archived: 2026-01-20T04:20:26.064Z*

- **File**: js/agents/vfs/vfs.opfs.js:125
- **Description**: OpfsVfs.readFile 在文件不存在时返回 null，而 Memory/Storage/Node VFS 抛 ENOENT，跨后端行为不一致，影响调用方的错误分支处理。
- **Suggestion**: 统一 readFile 缺失文件的语义（全部抛 ENOENT 或全部返回 null），并同步更新文档/调用方逻辑。
```
    try {
      const handle = await getFileHandle(this._root, p, { create: false });
      const file = await handle.getFile();
      const buf = await file.arrayBuffer();
      return new Uint8Array(buf);
    } catch (err) {
      if (err?.name === "NotFoundError") return null;
      if (err?.name === "TypeMismatchError") throw new Error(`EISDIR: ${p}`);
      throw err;
    }
```

---

## Archived: 2026-01-20

### [RESOLVED] atomic-write
*Archived: 2026-01-20T00:14:50.691Z*

- **File**: js/agents/vfs/operations.js:601
- **Description**: atomicWriteText/atomicWriteFile 的回退路径依赖 vfs.delete，但 MemoryVfs/OpfsVfs/NodeFsVfs 均未实现 delete；在无 rename 的后端会跳过清理，临时文件残留且不满足原子写入要求。
- **Suggestion**: 为 VFS 统一提供 delete/unlink/rename 适配层（或在此处兼容 unlink/rm），保证临时文件清理并尽可能提供原子性语义。
```
        if (typeof vfs.rename === "function") {
          await vfs.rename(tempPath, normalizedPath);
        } else {
          try {
            const exists = typeof vfs.exists === "function" ? await vfs.exists(normalizedPath) : true;
            if (exists && typeof vfs.delete === "function") {
              await vfs.delete(normalizedPath);
            }
          } catch {
            // 忽略删除错误
          }
          await vfs.writeText(normalizedPath, content);
          // 清理临时文件
          try {
            if (typeof vfs.delete === "function") {
              await vfs.delete(tempPath);
            }
          } catch {
            // 忽略清理错误
          }
        }
```

### [RESOLVED] quota-management
*Archived: 2026-01-20T00:14:50.691Z*

- **File**: js/agents/vfs/vfs.storage.js:162
- **Description**: StorageVfs 写入未捕获 QuotaExceededError，也没有降级/提示逻辑；存储满时会直接抛错，不满足“配额不足时优雅降级”的要求。
- **Suggestion**: 捕获配额异常并返回可识别的错误/提示，必要时回退到 MemoryVfs 或引导用户清理空间；可结合 storageAdapter.getUsage() 做预检查。
```
  async writeFile(path, data) {
    const p = normalizeVfsPath(path);
    if (!p) throw new Error("EISDIR: /");
    await this._ensureDir(dirnameVfsPath(p));

    const bytes =
      typeof Blob !== "undefined" && data instanceof Blob
        ? new Uint8Array(await data.arrayBuffer())
        : dataToBytes(data);
    const key = this._fileKey(p);
    await this._store.set(key, {
      kind: "file",
      path: p,
      encoding: "base64",
      data: bytesToBase64(bytes),
      size: bytes.byteLength,
      mtimeMs: Date.now(),
    });
    return true;
  }
```

---

## Archived: 2026-01-18

### [RESOLVED] data-encoding
*Archived: 2026-01-18T22:12:59.091Z*

- **File**: js/agents/vfs/storage-adapter.js:169
- **Description**: OpfsStorageAdapter 的 key 编码/解码不可逆：编码用 encodeURIComponent 并把 % 替换为 "_"，keys() 再把所有 "_" 变回 "%"，会让原始包含下划线的 key 无法解码或发生冲突。
- **Suggestion**: 改为可逆编码（如 base64url），或同时转义 "_" 并在解码时仅还原真实转义序列。
```
return encodeURIComponent(String(key)).replace(/%/g, "_");
```

### [RESOLVED] resource-leak
*Archived: 2026-01-18T22:12:59.091Z*

- **File**: js/agents/vfs/storage-adapter.js:194
- **Description**: OpfsStorageAdapter.set 在 write 失败时不会关闭 writable，可能导致句柄泄漏或后续写入异常。
- **Suggestion**: 使用 try/finally 包裹 write，并在 finally 中关闭 writable。
```
const writable = await fileHandle.createWritable();
```

### [RESOLVED] convention
*Archived: 2026-01-18T22:12:59.091Z*

- **File**: js/agents/vfs/operations.js:361
- **Description**: 事件名使用了点号 vfs.write.completed，与约定的 domain:action 格式不一致。
- **Suggestion**: 改为 vfs:write:completed 或 vfs:writeCompleted 等 domain:action 风格。
```
emit?.("vfs.write.completed", {
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T22:12:59.091Z*

- **File**: js/agents/vfs/index.js:12
- **Description**: 导出的 createVfs 未给出 @param/@returns 类型注解（同样问题存在于 index.browser.js、index.node.js）。
- **Suggestion**: 补充完整 JSDoc（options 结构、返回类型），并同步到各入口文件。
```
export async function createVfs(options = {}) {
```

---

