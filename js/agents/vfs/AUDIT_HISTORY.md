# Audit History - vfs

Archived issues from security audits.

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

