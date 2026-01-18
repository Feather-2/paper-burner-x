# Audit History - crdt

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] input-validation
*Archived: 2026-01-18T21:07:46.234Z*

- **File**: js/agents/core/crdt/sync-manager.js:254
- **Description**: 未校验远端 message.op 的结构与字段，恶意或畸形消息可能导致状态污染或异常分支。
- **Suggestion**: 在 applyOp 前校验 op 必需字段（field/fieldType/version/docId/type）并限制单条 op 的大小。
```
const applied = doc.applyOp(/** @type {any} */ (message.op));
```

### [RESOLVED] input-validation
*Archived: 2026-01-18T21:07:46.234Z*

- **File**: js/agents/core/crdt/sync-manager.js:287
- **Description**: 未限制 message.ops 数量与内容，远端可发送超大数组造成 CPU/内存压力或状态污染。
- **Suggestion**: 为 ops 设置长度/字节上限并逐条校验结构，异常时丢弃或记录告警。
```
const applied = doc.applyOps(/** @type {any} */ (message.ops));
```

### [RESOLVED] resource-exhaustion
*Archived: 2026-01-18T21:07:46.234Z*

- **File**: js/agents/core/crdt/sync-manager.js:164
- **Description**: 离线时 _pendingOps 队列无上限，长时间断线或高频写入会导致内存膨胀。
- **Suggestion**: 设置最大队列/字节上限，超限时合并、丢弃或落盘持久化。
```
this._pendingOps.push(message);
```

### [RESOLVED] convention
*Archived: 2026-01-18T21:07:46.234Z*

- **File**: js/agents/core/crdt/sync-manager.js:388
- **Description**: 事件名由 crdt:${event} 组装，调用处传入 op:sent 等导致 crdt:op:sent，不符合 domain:action 单冒号约定。
- **Suggestion**: 改为传入不含冒号的 action（如 opSent），或统一命名为 crdt:opSent 等单冒号格式。
```
this._events.emit(`crdt:${event}`, data);
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:07:46.234Z*

- **File**: js/agents/core/crdt/index.js:37
- **Description**: 导出的 createOp 未提供 @param/@returns 注解，API 类型信息不完整。
- **Suggestion**: 为 createOp 补充 JSDoc 参数/返回类型，并考虑定义 Op 的 typedef。
```
export function createOp(type, key, value, clock) {
```

### [RESOLVED] state-consistency
*Archived: 2026-01-18T21:07:46.234Z*

- **File**: js/agents/core/crdt/document.js:339
- **Description**: 远端 counter op 与本地 counter 类型不一致时仍会应用，可能导致计数语义偏差。
- **Suggestion**: 校验 op.type 与本地 counter 类型一致，不一致时拒绝、告警或升级为 PNCounter。
```
changed = counter instanceof PNCounter
  ? counter.apply(/** @type {any} */ (op))
  : counter.apply(/** @type {any} */ (op.op || op));
```

### [RESOLVED] dead-code
*Archived: 2026-01-18T21:07:46.234Z*

- **File**: js/agents/core/crdt/sync-manager.js:428
- **Description**: createMemoryTransport 中的 listeners 未被使用，降低可维护性。
- **Suggestion**: 移除未使用变量或实现其预期用途。
```
const listeners = new Set();
```

---

