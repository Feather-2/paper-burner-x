# Audit History - checkpoints

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] JSDoc / code style
*Archived: 2026-01-18T20:43:28.427Z*

- **File**: js/agents/runtime/checkpoints/agent-checkpoint-store.js:168
- **Description**: 导出的 AgentCheckpointStore 及其公共方法缺少完整 JSDoc，内部辅助函数也未标注 `@private`，与项目规范不一致。
- **Suggestion**: 为公共 API 添加 JSDoc（含参数/返回值/异常），并为内部工具函数补充 `/** @private */` 标记。
```
export class AgentCheckpointStore {
```

---

## Archived: 2026-01-18

### [RESOLVED] unvalidated input
*Archived: 2026-01-18T20:40:47.464Z*

- **File**: js/agents/runtime/checkpoints/agent-checkpoint-store.js:263
- **Description**: 从存储读取的 checkpoint/index 仅经过 JSON 解析就返回，未校验 schemaVersion/kind/字段类型；若存储被污染或接入外部存储，可能传播异常结构或危险元数据。
- **Suggestion**: 增加最小 schema 校验与字段白名单（含 metadata 的 plain object 检查），对非法数据返回 null 或回退默认值。
```
return safeJsonParse(raw, { maxChars: 5_000_000 });
```

---

## Archived: 2026-01-18

### [RESOLVED] path safety / namespace collision
*Archived: 2026-01-18T20:39:38.562Z*

- **File**: js/agents/runtime/checkpoints/agent-checkpoint-store.js:42
- **Description**: runId 仅做字符替换后直接拼接路径，允许 `.`/`..` 段且会把如 `a/b` 规范化成 `a_b`，导致不同 runId 指向同一路径；同时锁键仍用原始 runId，可能在同一目录上发生并发竞态或跨 run 访问。
- **Suggestion**: 对 runId 做严格校验并拒绝 `.`/`..` 与非法字符，或先生成规范化 runId 再统一用于路径、锁键和持久化字段，避免碰撞与越界。
```
return raw.replace(/[^a-zA-Z0-9._-]/g, "_");
```

---

