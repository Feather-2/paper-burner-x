# Audit History - memory

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] path traversal
*Archived: 2026-01-19T20:49:38.871Z*

- **File**: js/agents/plugins/memory/l3-storage.js:385
- **Description**: snapshotId/checkpointId 直接拼接到文件路径且未校验，调用方可传入 ../ 等片段逃逸 .agents/runs/<runId>/l3 目录，导致任意读写 VFS。
- **Suggestion**: 新增 snapshotId/checkpointId 校验（拒绝 .. / \ / %2e 等），或使用白名单 ID 格式（如 /^snap_[a-z0-9_-]+$/）。在 getSnapshot/getCheckpoint/checkpoint/eviction 等入口统一校验。
```
await this._io.writeJson(this._io.checkpointPath(id), checkpoint);
```

---

## Archived: 2026-01-19

### [RESOLVED] prototype pollution
*Archived: 2026-01-19T20:48:54.950Z*

- **File**: js/agents/plugins/memory/state-engine.reducers.js:277
- **Description**: L1 scratchpad/syncTable 使用用户输入的 key 作为对象属性，未过滤 __proto__/constructor/prototype，可污染原型链并影响整个运行时。
- **Suggestion**: 为 key 增加 UNSAFE_KEYS 黑名单检查，或使用 Map / Object.create(null) 存储可变键。
```
return { ...state, L1: { ...L1, scratchpad: { ...L1.scratchpad, [key]: value } } };
```

---

## Archived: 2026-01-19

### [RESOLVED] prototype pollution
*Archived: 2026-01-19T20:48:40.942Z*

- **File**: js/agents/plugins/memory/memory-store.impl.l1.js:125
- **Description**: MemoryStore scratchpad 直接 Object.assign/索引赋值未校验 key，存在原型污染风险。
- **Suggestion**: 同样引入 UNSAFE_KEYS 校验或改用 Map / Object.create(null)。
```
this._L1.scratchpad[key] = value;
```

---

## Archived: 2026-01-19

### [RESOLVED] unsafe deserialization
*Archived: 2026-01-19T20:48:29.889Z*

- **File**: js/agents/plugins/memory/l3-storage/storage-io.js:33
- **Description**: readJson 对 VFS 文件内容直接 JSON.parse，缺少 try/catch 与结构验证；被篡改或损坏的文件会抛错或注入异常结构。
- **Suggestion**: 为 JSON.parse 增加 try/catch，并对 index/snapshot/checkpoint 结构进行校验；异常时返回 null 或触发恢复流程。
```
return JSON.parse(text);
```

---

## Archived: 2026-01-19

### [RESOLVED] error handling
*Archived: 2026-01-19T20:48:03.248Z*

- **File**: js/agents/plugins/memory/retrieval-engine.js:272
- **Description**: 多个空 catch 块吞掉异常（如 progressCallback 或 embed/index 失败），违反“异常需记录或重新抛出”的约定，降低可观测性。
- **Suggestion**: 至少记录 warn/debug 或通过 eventBus 发送错误事件；必要时将错误计数纳入返回值。
```
try { progressCallback(indexed, total); } catch { /* ignore */ }
```

---

