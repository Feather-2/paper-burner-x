# Audit History - l3-storage

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] 私有函数未标注
*Archived: 2026-01-19T20:45:04.160Z*

- **File**: js/agents/plugins/memory/l3-storage/tab-coordinator.js:28
- **Description**: callTabCoordinatorHandler/callTabCoordinatorHandlers 为内部 helper，未按规范标记 /** @private */。
- **Suggestion**: 为内部 helper 添加 /** @private */ 注释，或改为内联以避免公开 API 歧义。
```
function callTabCoordinatorHandler(handler, sessionId, label, logger) {
```

---

## Archived: 2026-01-19

### [RESOLVED] JSDoc 不完整
*Archived: 2026-01-19T20:44:54.172Z*

- **File**: js/agents/plugins/memory/l3-storage/hash.js:4
- **Description**: cyrb53/computeContentHash 的 @param/@returns 缺少描述，违反公共 API JSDoc 规范。
- **Suggestion**: 为每个 @param 添加描述，并为 computeContentHash 的 @returns 补充说明（例如内容哈希十六进制字符串）。
```
* @param {string} str
```

---

## Archived: 2026-01-19

### [RESOLVED] 缺少 JSDoc
*Archived: 2026-01-19T20:44:01.253Z*

- **File**: js/agents/plugins/memory/l3-storage/index-manager.js:4
- **Description**: index-manager.js 中多个导出函数缺少完整 JSDoc，公共 API 说明不完整。
- **Suggestion**: 为所有 export 函数补充完整 JSDoc（@param/@returns/@throws）并明确输入/输出结构；query.js/storage-io.js/tab-coordinator.js/utils.js 同步补齐。
```
export function createIndexState() {
```

---

## Archived: 2026-01-19

### [RESOLVED] 路径穿越
*Archived: 2026-01-19T20:43:46.930Z*

- **File**: js/agents/plugins/memory/l3-storage/storage-io.js:121
- **Description**: snapshotPath/checkpointPath 直接拼接 id，若调用方传入包含 .. 或路径分隔符的 id，可在 VFS 中访问/覆盖非预期路径。
- **Suggestion**: 新增 validateSnapshotId/validateCheckpointId（禁止 ..、斜杠或反斜杠）并在 createStorageIO 或 L3Storage 的所有入口统一校验，必要时限制格式为 ^(snap|ckpt)_[a-z0-9]+$。
```
return `${snapshotsDir}/${id}.json`;
```

---

