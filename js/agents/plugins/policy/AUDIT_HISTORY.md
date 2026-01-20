# Audit History - policy

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] authorization
*Archived: 2026-01-20T04:23:27.958Z*

- **File**: `js/agents/plugins/policy/engine.js`:60
- **Description**: normalizeEffect 对任何非 "deny" 的 effect 统一返回 "allow"，规则拼写错误或无效值会 fail-open，可能导致审批被绕过。
- **Suggestion**: 仅接受 allow/deny；无效 effect 时返回 null 并在 normalizeRule 中丢弃或记录警告，或默认走 deny/prompt。
```
const e = toNonEmptyString(effect).toLowerCase();
if (e === "deny") return "deny";
return "allow";
```

### [RESOLVED] error-handling
*Archived: 2026-01-20T04:23:27.958Z*

- **File**: `js/agents/plugins/policy/manager.js`:128
- **Description**: waitForApprovalResponse 中取消订阅异常被空 catch 吞掉，违反错误处理规范且可能隐藏事件总线异常。
- **Suggestion**: 记录 warn/debug 并包含 requestId，或先校验 off 为函数再调用以避免异常。
```
try {
  off?.();
} catch {
  // ignore
}
```

### [RESOLVED] test-coverage
*Archived: 2026-01-20T04:23:27.958Z*

- **File**: `js/agents/plugins/policy/store.js`:46
- **Description**: PolicyRuleStore 与 PolicyManager 关键边界路径缺少测试（localStorage 回退/损坏数据、timeout/abort、空值等）；目前仅看到 PolicyEngine 行为测试，可能达不到覆盖率与边界条件要求。
- **Suggestion**: 补充单元测试覆盖 localStorage/内存回退、坏数据解析、空值/边界值，以及 PolicyManager 审批超时/abort/remember 分支。
```
load() {
  if (this._cache) return [...this._cache];

  if (!hasLocalStorage()) {
    this._cache = [...(MEMORY.rules || [])];
    return [...this._cache];
  }

  const raw = localStorage.getItem(this.storageKey);
```

---

