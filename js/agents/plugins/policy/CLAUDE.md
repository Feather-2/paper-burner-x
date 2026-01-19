# policy - 策略与审批

访问策略匹配与审批决策，覆盖工具/资源请求的 allow/deny/prompt 流程。

## 模块描述

该模块提供规则归一化、匹配与决策引擎，并通过事件总线驱动交互式审批，配套本地规则存储与请求摘要/哈希。

## 核心文件

| 文件 | 职责 |
|------|------|
| `engine.js` | PolicyEngine：规则归一化、条件匹配与决策排序 |
| `manager.js` | PolicyManager：审批流程、事件通知、规则派生与落盘 |
| `match.js` | 通配符/Glob 匹配工具，避免动态正则 ReDoS |
| `store.js` | PolicyRuleStore：localStorage + 内存缓存持久化 |

## 关键概念

- **PolicyRule / NormalizedPolicyRule**：规则含 `ruleId/effect/enabled/priority/updatedAt`，`type` 可为字符串或数组（`type/types`），`tool/resource/path` 支持通配符与 glob；归一化时补齐 `createdAt/updatedAt` 并排序。
- **PolicyRequest / PolicyDecision**：请求字段包含 `schemaVersion/requestId/type/tool/resource/path/ts/args/argsHash/argsSummary/runId`，决策包含 `allowed/requiresApproval` 与原因。
- **匹配维度**：`type/tool/resource/path(glob)/domainSuffixes/timeRange/match(all|any|not)`；`timeRange` 支持 `start/end` 或 `startMin/endMin`，`timezone(local|utc)`，可选 `daysOfWeek`。
- **决策顺序**：先匹配 `deny`，再匹配 `allow`；无命中按 `defaultEffect`；缺少 `type` 直接 `requiresApproval`。
- **优先级**：`priority` 高者优先，`updatedAt` 作为同级 tie-breaker。
- **事件流**：`policy.requested` → `policy.approval.requested` →（外部发送 `policy.approval.response`）→ `policy.approval.responded` → `policy.decided`，必要时触发 `policy.rule.added`。
- **非交互回退**：`interactive=false` 时按 `onMissingApprovalProvider` 回退（Node 默认 allow，Browser 默认 deny），原因 `non_interactive_allow/deny`。

## 常见任务

### 1) 直接评估规则

```javascript
import { PolicyEngine } from 'js/agents/runtime/policy';

const engine = new PolicyEngine({
  defaultEffect: 'prompt',
  rules: [{ effect: 'deny', type: 'tool', tool: 'bash', enabled: true }],
});

const decision = engine.evaluate({ type: 'tool', tool: 'bash' });
// → { allowed: false, requiresApproval: false, reason: 'matched_deny_rule' }
```

### 2) 走审批流程 (EventBus)

```javascript
import { PolicyManager } from 'js/agents/runtime/policy';

const manager = new PolicyManager({ eventBus, interactive: true });
const result = await manager.authorize({
  type: 'tool',
  tool: 'read',
  args: { path: 'docs/readme.md' },
});
// 需要审批时会触发 policy.approval.requested（包含 argsSummary）
```

```javascript
eventBus.emit('policy.approval.response', {
  requestId: result.request.requestId,
  decision: 'allow',
  remember: 'always',
  reason: 'approved by user',
});
```

### 3) 持久化规则

```javascript
import { PolicyRuleStore } from 'js/agents/runtime/policy';

const store = new PolicyRuleStore();
store.save([
  {
    ruleId: 'rule_1',
    effect: 'allow',
    type: 'tool',
    tool: 'read',
    enabled: true,
    priority: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]);

const rules = store.load();
```

### 4) 复杂条件示例

```javascript
const rule = {
  effect: 'allow',
  type: ['tool', 'resource'],
  tool: 'read*',
  path: ['**/*.md'],
  domainSuffixes: ['example.com'],
  timeRange: { start: '09:00', end: '18:00', timezone: 'local', daysOfWeek: [1, 2, 3, 4, 5] },
  match: { any: [{ resource: 'https://example.com/*' }, { tool: 'glob' }] },
};
```