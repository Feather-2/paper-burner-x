# Audit History - side-effects

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] private_annotation
*Archived: 2026-01-18T19:36:30.488Z*

- **File**: js/agents/runtime/side-effects/side-effect-journal.js:586
- **Description**: 下划线私有方法未使用 /** @private */ 标记（_appendToStorage/_getWalPath 等）。
- **Suggestion**: 在私有方法前添加 @private 注解，或改为 #private。
```
async _appendToStorage(entry) {
```

---

## Archived: 2026-01-18

### [RESOLVED] unsafe_deserialization
*Archived: 2026-01-18T19:35:24.399Z*

- **File**: js/agents/runtime/side-effects/side-effect-journal.js:440
- **Description**: WAL 回放对每行执行 JSON.parse，缺少大小/结构校验；若 WAL 文件被篡改或过大，可能导致 DoS 或异常状态。
- **Suggestion**: 增加 WAL 文件/单行大小上限，并对解析结果做结构验证（kind/ts/reversible 等），超限或异常时中止或降级处理。
```
parsed = JSON.parse(line);
```

### [RESOLVED] jsdoc_any
*Archived: 2026-01-18T19:35:24.399Z*

- **File**: js/agents/runtime/side-effects/side-effect-journal.js:27
- **Description**: SideEffectJournalOptions 使用 any 类型（runStore/storageAdapter/vfs/eventBus/logger），违反“禁止 any 类型”规范，弱化类型约束。
- **Suggestion**: 为依赖注入对象定义明确 @typedef（例如 RunStoreLike/VfsLike/EventBusLike）。
```
* @property {any=} runStore
```

---

## Archived: 2026-01-18

### [RESOLVED] function_length
*Archived: 2026-01-18T19:33:30.691Z*

- **File**: js/agents/runtime/side-effects/side-effect-journal.js:515
- **Description**: rollbackToCursor 超过 50 行且包含多段职责（校验/回滚循环/事件派发），与单一职责规范不符。
- **Suggestion**: 将回滚循环与事件派发拆分为私有辅助函数，降低长度与嵌套层级。
```
async rollbackToCursor(cursor, { reason } = {}) {
```

---

## Archived: 2026-01-18

### [RESOLVED] jsdoc_param_description
*Archived: 2026-01-18T19:32:58.508Z*

- **File**: js/agents/runtime/side-effects/side-effect-journal.js:84
- **Description**: @param 缺少描述（如 toIso/normalizeCursor 等），不符合 JSDoc 规范“必须有描述”。
- **Suggestion**: 为每个 @param/@returns 添加简短语义说明。
```
* @param {unknown} ts
```

---

## Archived: 2026-01-18

### [RESOLVED] error_handling
*Archived: 2026-01-18T19:31:18.387Z*

- **File**: js/agents/runtime/side-effects/side-effect-journal.js:281
- **Description**: 多处空 catch 块吞掉异常（unsubscribe/emit/vfsExists/compact），与“不要吞掉异常”规范冲突，降低可观测性。
- **Suggestion**: 至少记录 warn 级日志并包含上下文，或重新抛出包装错误，避免静默失败。
```
try { this._unsub(); } catch {
```

---

## Archived: 2026-01-18

### [RESOLVED] path_traversal
*Archived: 2026-01-18T19:29:37.283Z*

- **File**: js/agents/runtime/side-effects/side-effect-journal.js:652
- **Description**: runId/walDir 未做路径净化即拼接 WAL 路径，若 runId 可控可通过 ../ 等实现目录穿越，导致 WAL 读写落到任意 VFS 路径。
- **Suggestion**: 对 runId/walDir 做白名单校验（拒绝 ../、绝对路径、路径分隔符），或将 runId 映射为安全文件名（base64url/slug），并限制 walDir 在允许目录内。
```
return joinVfsPath(dir, `${id}.jsonl`);
```

---

