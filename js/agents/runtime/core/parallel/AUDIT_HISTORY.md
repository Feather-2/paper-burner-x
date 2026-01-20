# Audit History - parallel

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] jsdoc
*Archived: 2026-01-20T00:25:19.254Z*

- **File**: js/agents/runtime/core/parallel/task-graph.js:30
- **Description**: 公共 API 的 JSDoc 参数缺少描述（addTask/getTask/getLevels），不符合项目 JSDoc 规范，降低可读性与可维护性。
- **Suggestion**: 为 addTask/getTask/getLevels 的 @param/@returns 添加简短描述，并在必要时补充 @throws 说明。
```
/**
   * @param {string} taskId
   * @param {string[] | null | undefined} [dependencies]
   * @returns {this}
   */
```

### [RESOLVED] maintainability
*Archived: 2026-01-20T00:25:19.254Z*

- **File**: js/agents/runtime/core/parallel/task-graph.js:63
- **Description**: getLevels 超过 50 行且嵌套深度超过 3 层，违背代码风格约定，后续扩展/调试成本偏高。
- **Suggestion**: 拆分初始化依赖索引与层级推进逻辑为独立私有函数，降低单函数长度与嵌套深度。
```
getLevels(options = {}) {
    const allowMissing = options?.allowMissingDependencies === true;
    ...
    while (queue.length) {
      ...
      for (const id of current) {
        ...
        for (const depId of nextSet) {
          ...
        }
      }
    }
  }
```

### [RESOLVED] test-coverage
*Archived: 2026-01-20T00:25:19.254Z*

- **File**: tests/integration/agents/runtime.test.js:1723
- **Description**: TaskGraph 测试仅覆盖正常/循环/缺失依赖，未覆盖要求的边界条件（空值/非法 taskId、allowMissingDependencies、重复依赖等）。
- **Suggestion**: 新增针对空/非法 taskId、非数组依赖、重复依赖、allowMissingDependencies=true 的测试用例，并覆盖边界输入。
```
it("Runtime: TaskGraph layered topo sort + cycle/missing detection", async () => {
  const { TaskGraph } = await import("../../js/agents/runtime/parallel/task-graph.js");
  ...
  expect(levels).toEqual([["A"], ["B", "C"], ["D"]]);
  ...
  expect(() => missing.getLevels()).toThrow(/missing dependency/i);
});
```

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

