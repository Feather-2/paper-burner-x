# Audit History - storage

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] unsafe-deserialization
*Archived: 2026-01-19T23:43:13.289Z*

- **File**: js/agents/storage/run-store-queries.js:284
- **Description**: storageAdapter 模式下的 manifest 读取后直接 JSON.parse，遇到被篡改/损坏数据会抛异常或产生非预期结构。
- **Suggestion**: 改用 safeJsonParse 并验证 manifest 结构；解析失败记录告警并返回 null 或受控错误。
```
return data ? JSON.parse(data) : null;
```

---

## Archived: 2026-01-19

### [RESOLVED] error-handling
*Archived: 2026-01-19T23:42:55.733Z*

- **File**: js/agents/storage/run-store-cache.js:339
- **Description**: cleanupRuns 在删除失败时吞掉异常，违反错误处理约定，可能导致清理失败但结果显示成功。
- **Suggestion**: 记录警告（含 runId 与错误信息）或累计错误并返回给调用方，避免静默失败。
```
try { await this.deleteRun(runId); deletedRunIds.push(runId); } catch { // ignore individual delete errors }
```

---

## Archived: 2026-01-19

### [RESOLVED] unsafe-deserialization
*Archived: 2026-01-19T23:42:51.964Z*

- **File**: js/agents/storage/run-exporter.js:446
- **Description**: importRunFromZip 对来自 zip 的 manifest.json 直接 JSON.parse，缺少结构校验与失败兜底；恶意或损坏的压缩包可能触发崩溃或生成异常的运行数据。
- **Suggestion**: 使用 safeJsonParse 并做 schema 校验（runId、artifacts 数量/字段）；解析失败返回友好错误，同时限制 manifest 大小/字段数量。
```
const manifest = JSON.parse(manifestText);
```

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

