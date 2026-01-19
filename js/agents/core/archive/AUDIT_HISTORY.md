# Audit History - archive

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] race-condition
*Archived: 2026-01-20T04:20:00.000Z*

- **File**: `js/agents/core/archive/archive-core.js`:229
- **Description**: Archive.save 通过读取存储后生成 checkpointId 再写入；并发 save 在同一时间戳下可能覆盖快照并破坏 diff 追踪状态。
- **Fix Applied**: 添加了 `_saveLocks` Map 实现 per-runId 异步互斥锁，确保同一 runId 的 save() 调用串行执行。
- **Verification**: `Promise.all([archive.save('run1', {...}), archive.save('run1', {...})])` 现在生成唯一 ID (run1:123, run1:123-1)。

---

## Archived: 2026-01-18

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:28:32.459Z*

- **File**: `js/agents/shared/archive/archive.js`:632
- **Description**: MapAdapter/IndexedDBAdapter/FallbackAdapter 的公开方法缺少 @param/@returns 类型注解。
- **Suggestion**: 为适配器类及其 get/set/delete/keys/clear/close 添加 JSDoc，或定义统一 Adapter @typedef 并引用。
```
export class MapAdapter {
  constructor() {
    this.store = new Map();
  }

  async get(key) {
```

### [RESOLVED] robustness
*Archived: 2026-01-18T21:28:32.459Z*

- **File**: `js/agents/shared/archive/archive.js`:412
- **Description**: diff 快照恢复递归缺少循环检测/深度限制，base 指向链成环时可能无限递归或栈溢出，存在 DoS 风险。
- **Suggestion**: 在 _restoreCheckpointInternal 引入 visited set 或 maxDepth；检测循环后抛出可诊断错误或回退到完整快照。
```
const base = await this._restoreCheckpointInternal(baseId);
const reconstructed = applyJsonPatch(base?.nodeStates ?? {}, patch);
```

### [RESOLVED] async-error-handling
*Archived: 2026-01-18T21:28:32.459Z*

- **File**: `js/agents/shared/archive/archive.js`:735
- **Description**: IndexedDBAdapter 事务仅监听 request.onerror/onsuccess，未处理 tx.onerror/tx.onabort，事务中断时 Promise 可能悬挂。
- **Suggestion**: 在 get/set/delete/keys/clear 中补充 tx.onerror/tx.onabort -> reject，确保所有失败路径结束 Promise。
```
const tx = db.transaction(this.storeName, "readwrite");
const store = tx.objectStore(this.storeName);
const request = store.put({ key: String(key), value });
request.onerror = () => reject(request.error);
request.onsuccess = () => resolve(true);
```

---

