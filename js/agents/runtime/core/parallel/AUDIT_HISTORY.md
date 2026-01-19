# Audit History - parallel

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] 逻辑错误
*Archived: 2026-01-18T21:21:08.820Z*

- **File**: `js/agents/runtime/parallel/task-graph.js`:73
- **Description**: allowMissingDependencies 为 true 时仍将缺失依赖计入入度，导致任务无法入队并最终抛出 cycle detected，选项语义失效。
- **Suggestion**: 在 allowMissingDependencies 为 true 时先过滤缺失依赖再计算入度与依赖边，例如基于 this._tasks.has(depId) 过滤后的 deps。
```
inDegree.set(id, task.dependencies.length);
```

### [RESOLVED] 健壮性
*Archived: 2026-01-18T21:21:08.820Z*

- **File**: `js/agents/runtime/parallel/task-graph.js`:39
- **Description**: 重复依赖未去重，inDegree 按数组长度计数而 dependents 用 Set 去重，可能导致入度无法归零并触发假循环。
- **Suggestion**: 在保存依赖或计算入度时对 deps 去重（如 Array.from(new Set(deps))），确保入度与依赖边一致。
```
const deps = Array.isArray(dependencies)\n      ? dependencies.map((d) => toNonEmptyString(d)).filter(Boolean)\n      : [];
```

---

