# Audit History - context

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] 未验证的输入
*Archived: 2026-01-18T21:14:21.728Z*

- **File**: js/agents/runtime/context/subagent-budget.js:144
- **Description**: allocate/recordUsage/adjustParentBudget 对预算与用量未做 Number.isFinite 校验；非数值会变成 NaN，导致最小预算校验失效、remaining 计算异常或预算统计被污染。
- **Suggestion**: 对 requestedBudget/tokensUsed/newBudget 做 Number.isFinite 校验与边界裁剪，非法值直接返回错误或回退默认值。
```
budget = Math.min(requestedBudget, maxForMode, available);
```

### [RESOLVED] 未验证的输入
*Archived: 2026-01-18T21:14:21.728Z*

- **File**: js/agents/runtime/context/unified-agent-context.js:162
- **Description**: addClaim 在写入 SharedContext 时直接访问 claim.text/claim.content；当 claim 为 null/非对象时会抛错并中断流程。
- **Suggestion**: 进入 addClaim 时校验 claim 为对象，或在 addFinding 处使用可选链并在无效输入时提前返回。
```
content: claim.text || claim.content || "",
```

### [RESOLVED] 资源泄漏
*Archived: 2026-01-18T21:14:21.728Z*

- **File**: js/agents/runtime/context/subagent-budget.js:229
- **Description**: release/abort 仅更新状态未删除记录，_allocations 会累积已完成/中止的记录；长时间运行可能导致内存增长。
- **Suggestion**: 在完成/中止后 delete 记录，或增加历史上限/定期清理策略。
```
record.status = "completed";
```

### [RESOLVED] JSDoc 规范
*Archived: 2026-01-18T21:14:21.728Z*

- **File**: js/agents/runtime/context/snapshotable.js:9
- **Description**: Snapshotable 定义与守卫使用 {any} 且 @param 缺少描述，违反“禁止 any/必须有描述”的 JSDoc 规则。
- **Suggestion**: 定义 SnapshotOptions 的 @typedef 或使用 Record<string, unknown>，补充 @param 描述并为 assertSnapshotable 添加 @throws。
```
@property {(options?: any) => object} toSnapshot
```

### [RESOLVED] JSDoc 规范
*Archived: 2026-01-18T21:14:21.728Z*

- **File**: js/agents/runtime/context/unified-agent-context.js:84
- **Description**: UnifiedAgentContext 多个 public 方法缺少完整 JSDoc（如 setTaskGoal/addTodo/saveCheckpoint 等），不符合公共 API 注解要求。
- **Suggestion**: 为公共方法补充 @param/@returns/@throws 描述，保持接口文档一致。
```
setTaskGoal(goal) {
```

### [RESOLVED] 死代码
*Archived: 2026-01-18T21:14:21.728Z*

- **File**: js/agents/runtime/context/unified-agent-context.js:15
- **Description**: isPlainObject 引入后未使用，属于无效依赖，增加维护噪声。
- **Suggestion**: 移除未使用的 isPlainObject import，或补上其用途。
```
import { isPlainObject, toNonEmptyString, deepClone } from "../../shared/utils/value-utils.js";
```

---

