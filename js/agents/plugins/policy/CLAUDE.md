# policy - 策略与审批

访问策略匹配与审批决策，覆盖工具/资源请求的 allow/deny/prompt 流程。

## 模块描述

该模块提供规则归一化、匹配与决策引擎，并通过事件总线驱动交互式审批，配套本地规则存储与请求摘要/哈希。

## 核心文件

| 文件 | 职责 |
|------|------|
| `engine.js` | PolicyEngine：规则归一化、条件匹配与决策排序 |
| `manager.js` | PolicyManager：审批流程、事件通知、请求摘要/哈希与落盘策略 |
| `match.js` | 通配符/Glob 匹配工具，避免动态正则 ReDoS |
| `store.js` | PolicyRuleStore：localStorage + 内存缓存持久化 |

## 关键概念

- **PolicyEffect / PolicyDefaultEffect**：`effect` 仅允许 `allow|deny`；`defaultEffect` 为 `prompt|allow|deny`。
- **PolicyRuleInput / NormalizedPolicyRule**：规则支持多组字段别名：
  - 标识：`ruleId` / `id`
  - 类型：`type` / `types`
  - 工具：`tool` / `toolPattern`
  - 资源：`resource` / `resourcePattern`
  - 路径：`path` / `paths`
  - 域后缀：`domainSuffixes` / `domainSuffix`
  - 主机后缀：`hostSuffixes` / `hostSuffix`
  - 时间条件：`timeRange` / `window` / `timeWindow` / `when`
  归一化时补齐/修正 `enabled/priority/createdAt/updatedAt` 并排序。
- **PolicyRequest / PolicyDecision**：请求字段包含 `schemaVersion/requestId/type/tool/resource/path/ts/args/argsHash/argsSummary/runId`；决策包含 `allowed/requiresApproval`，可携带命中的 `effect/ruleId` 与 `reason`。
- **匹配维度**：
  - `type/tool/resource/path` 支持通配符与 glob（`match.js` 负责模式归一化与匹配）。
  - 域名支持 `domainSuffixes/hostSuffixes`（用于对 URL/host 的后缀匹配）。
  - 时间条件支持 `timeRange/timeWindow`（如 `timezone`、`daysOfWeek`、`start/end` 或 `startMin/endMin`）。
  - 复杂组合通过 `match` 表达（如 `all|any|not`）。
- **决策顺序**：先匹配 `deny`，再匹配 `allow`；无命中按 `defaultEffect`；缺少 `type` 直接 `requiresApproval`。
- **优先级**：`priority` 高者优先，`updatedAt` 作为同级 tie-breaker。
- **事件流**：`policy.requested` → `policy.approval.requested` →（外部发送 `policy.approval.response`）→ `policy.approval.responded` → `policy.decided`，必要时触发 `policy.rule.added`。
- **非交互回退**：`interactive=false` 时按 `onMissingApprovalProvider` 回退（Node 默认 allow，Browser 默认 deny），原因 `non_interactive_allow/deny`。
- **ID 与摘要**：`requestId` 使用安全随机的时间戳 ID（`makeSecureTimestampedId`）；`argsHash` 可对 `args` 做 SHA-256 摘要（`computeSha256`）。

## 常见任务

### 1) 直接评估规则

```javascript
import { PolicyEngine } from 'js/agents/plugins/policy/engine.js';

const engine = new PolicyEngine({
  defaultEffect: 'prompt',
  rules: [{ effect: 'deny', type: 'tool', tool: 'bash', enabled: true }],
});

const decision = engine.evaluate({ type: 'tool', tool: 'bash' });
// → { allowed: false, requiresApproval: false, reason: 'matched_deny_rule' }
```

### 2) 走审批流程 (EventBus)

```javascript
import { PolicyManager } from 'js/agents/plugins/policy/manager.js';

const manager = new PolicyManager({ eventBus, interactive: true });
const result = await manager.authorize({
  type: 'tool',
  tool: 'read',
  args: { path: 'docs/readme.md' },
});
```
