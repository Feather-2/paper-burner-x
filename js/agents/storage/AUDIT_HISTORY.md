# Audit History - storage

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] compatibility
*Archived: 2026-01-18T22:04:01.778Z*

- **File**: js/agents/storage/artifact-manager.js:204
- **Description**: computeSha256 在浏览器模块中引入 node:crypto/Buffer 等 Node-only API，违反“无 Node-only API”要求，可能导致打包器解析失败或在非 Node 环境不可用。
- **Suggestion**: 将 Node 回退逻辑拆到 node-only 文件并按运行时环境选择，或仅使用 WebCrypto 并在不支持时返回 undefined。
```
const { createHash } = await import(/* @vite-ignore */ "node:crypto");
const h = createHash("sha256");
h.update(Buffer.from(buf));
```

### [RESOLVED] typescript
*Archived: 2026-01-18T22:04:01.778Z*

- **File**: js/agents/storage/artifact-manager.js:203
- **Description**: JS 文件中使用 @ts-ignore 指令，属于 TypeScript 语法，和“纯 JS + JSDoc”约定不一致。
- **Suggestion**: 改为运行时检测或拆分 Node-only 模块，避免在 JS 中使用 TS 指令。
```
/** @ts-ignore - node:crypto 仅 Node.js 可用，浏览器构建会忽略此路径 */
```

### [RESOLVED] security
*Archived: 2026-01-18T22:04:01.778Z*

- **File**: js/agents/storage/run-exporter.js:417
- **Description**: importRunFromZip 对外部 zip 直接 JSZip.loadAsync 解压且未做大小限制，可能被 zip bomb 触发内存/CPU 消耗。
- **Suggestion**: 在读取前校验文件大小或根据条目元数据设定上限，超限时拒绝导入。
```
const zip = await JSZip.loadAsync(zipInput);
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T22:04:01.778Z*

- **File**: js/agents/storage/run-store.js:231
- **Description**: RunStore 多个公开方法缺少 JSDoc 类型注解（如 saveTask/saveState/loadState），不符合项目 JSDoc 规范并降低类型可读性。
- **Suggestion**: 为公开方法补充 @param/@returns，并在类级或方法级定义输入/输出结构。
```
async saveTask(task) {
  if (!task || typeof task !== "object") throw new Error("saveTask(task): task must be an object");
  ...
}
```

---

