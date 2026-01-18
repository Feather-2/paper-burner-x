# Audit History - compression

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] JSDoc
*Archived: 2026-01-18T21:14:07.063Z*

- **File**: `js/agents/runtime/compression/compression-async.js`:41
- **Description**: compression-async.js 中多个导出函数缺少 @param/@returns 类型注解（terminateCompressionWorker / isCompressionWorkerAvailable / compressSessionHistorySync / compressAgentLoopMessagesAsync），不符合 JSDoc 覆盖约定。
- **Suggestion**: 为这些导出函数补充完整 JSDoc（@param/@returns，注明返回结构与可选项）。
```
export function terminateCompressionWorker() {
```

### [RESOLVED] Convention
*Archived: 2026-01-18T21:14:07.063Z*

- **File**: `js/agents/runtime/compression/watchdog.js`:133
- **Description**: 事件名使用点号（watchdog.intervention），与约定的 domain:action 格式不一致，可能导致事件订阅/过滤规则混乱。
- **Suggestion**: 统一事件命名为 domain:action（如 watchdog:intervention），并保留旧名称兼容或迁移方案。
```
this._emit(WatchdogEvents.WATCHDOG_INTERVENTION || "watchdog.intervention", {
```

### [RESOLVED] ErrorHandling
*Archived: 2026-01-18T21:14:07.063Z*

- **File**: `js/agents/runtime/compression/cicada-compressor.js`:731
- **Description**: _compressWithLLM 捕获异常后静默吞掉错误，缺乏日志或元数据标记，排查模型失败原因困难。
- **Suggestion**: 至少记录 warn/debug 日志或在 metadata 中保留 error 信息。
```
try { raw = await this._callModel([{ role: "user", content: prompt }]); } catch { raw = null; }
```

### [RESOLVED] Security
*Archived: 2026-01-18T21:14:07.063Z*

- **File**: `js/agents/runtime/compression/cicada-compressor.js`:872
- **Description**: listArchives 直接用 pattern 构造 RegExp，非法表达式会抛错，且存在潜在 ReDoS 风险（若 pattern 来自外部输入）。
- **Suggestion**: 对 pattern 做 try/catch 校验、转义为字面量或限制长度/复杂度。
```
const regex = new RegExp(pattern, "i");
```

---

