# Audit History - side-effects

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] testing/coverage
*Archived: 2026-01-20T04:29:31.162Z*

- **File**: js/agents/plugins/side-effects/side-effect-journal.js:361
- **Description**: 未发现针对 SideEffectJournal 的单元测试/边界测试，难以满足覆盖率 90% 目标与边界条件必测要求。
- **Suggestion**: 新增测试覆盖 replayFromStorage/rollbackToCursor/persist/compact 的空值、边界值、并发与非法 WAL 行等场景。
```
export class SideEffectJournal {
```

### [RESOLVED] quality/jsdoc-any
*Archived: 2026-01-20T04:29:31.162Z*

- **File**: js/agents/plugins/side-effects/side-effect-journal.js:129
- **Description**: 多个公开 API/JSDoc 使用 `any` 类型（event payload、eventBus、record entry、rollback 失败数组），违反“禁止 any 类型”规范。
- **Suggestion**: 为 payload/entry/eventBus/failures 定义明确的 @typedef（如 SideEffectJournalEventPayload）或使用 `unknown` + 运行时校验，移除 any。
```
/**
 * @typedef {object} SideEffectJournalEvent
 * @property {string=} eventId
 * @property {string|number=} ts
 * @property {any=} payload
 * @property {{ replay?: boolean }=} meta
 */
```

### [RESOLVED] quality/long-function
*Archived: 2026-01-20T04:29:31.162Z*

- **File**: js/agents/plugins/side-effects/side-effect-journal.js:532
- **Description**: replayFromStorage 与 rollbackToCursor 超过 50 行且嵌套较深，违反单一职责/长度限制，维护成本高。
- **Suggestion**: 将 WAL 解析/校验、entries 重建、回滚循环等逻辑提取为私有 helper（如 _readWalLines, _parseWalEntries, _applyRollback）。
```
async replayFromStorage(runId) {
  const id = toNonEmptyString(runId) || this.runId;
```

### [RESOLVED] quality/dead-code
*Archived: 2026-01-20T04:29:31.162Z*

- **File**: js/agents/plugins/side-effects/side-effect-journal.js:11
- **Description**: `VALID_ENTRY_KINDS` 未被使用，可能导致读者误以为有 kind 白名单校验。
- **Suggestion**: 若需要白名单校验，将其纳入 validateWalEntry；否则移除以避免误导。
```
/** Valid entry kinds for WAL structure validation. */
const VALID_ENTRY_KINDS = new Set(["vfs_checkpoint", "unknown"]);
```

---

