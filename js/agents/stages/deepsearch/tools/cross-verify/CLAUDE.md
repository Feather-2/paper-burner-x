# cross-verify - 交叉验证工具

用于在 DeepSearch 阶段对冲突信息进行交叉核实：针对某个 `factId`/Gap 及其冲突描述，启动专项子任务对比多来源证据，并把结果写回黑板/状态。支持异步启动与同步等待（带超时）。

## 模块描述

`cross-verify` 会基于 `factId` 与 `contradiction` 组织核查上下文（证据摘要、信源范围、规范化参数），通过 `task` 工具启动子代理进行对质验证；随后解析子任务报告（首段 JSON），将 verification 的状态、摘要与详情写入 `sharedContext/state`，并触发事件通知上层。

## 核心文件

| 文件 | 说明 |
|------|------|
| `handler.js` | 工具入口与完整流程：输入归一化/校验、证据收集与裁剪、任务启动、结果解析、状态回写、事件通知 |

## 关键概念

- 事实与冲突：`factId` 与 `contradiction` 为必填；`sourceIds` 可选，用于限定信源范围。
- 输入兼容：
  - `sources`/`sourceId` 作为 `sourceIds` 别名；
  - `subagentType` 作为 `subagent_type` 别名；
  - `sourceIds` 支持传入单个 `string` 或 `string[]`，并自动去重。
- 输入校验与边界：
  - `factId`/`contradiction` 会按长度上限截断（256/2000）；
  - `sourceIds` 最多 50 个，单项最多 256；
  - 保留 key（`__proto__`/`constructor`/`prototype`）直接拒绝（防原型污染）；
  - `async`/`force` 统一按布尔值解析；
  - `timeout` 仅在 `async=false` 时生效，并按数值安全解析。
- 证据收集：优先从 `sharedContext.search('evidence:${factId}')` 获取证据，再用 `sharedContext.getDetail` 拉详情；无结果时回退到 `DiscoveryManager.getEvidences`。
- 证据裁剪：证据摘要最多 12 行；单段 `snippet` 最多 400 字符，控制上下文大小与 token 风险。
- 信源推断：未提供 `sourceIds` 时，从证据中推断信源用于子任务。
- 子任务核查：
  - 使用 `task` 工具创建专项子任务，`subagent_type` 默认 `researcher`；
  - 支持 `researcher | analyzer`；
  - 始终异步创建任务；`async=false` 时等待完成（默认超时 600000ms）。
- 结论解析：要求子任务报告首段包含 JSON；`status` 映射到 `DiscoveryStatus`（`SATISFIED`/`CONTRADICTED`/`PARTIAL`/`BLOCKED`）。
- 状态与黑板：
  - 运行中与完成后的记录写入 `state.scratchpad.crossVerify`；
  - 写入 `sharedContext` 的 `cross_verify:${factId}` 指针与索引；
  - 完成后写入 `sharedContext.setSummary('verification', ...)` 并发送 `sharedContext.signal('verification', ...)`；
  - 同时按 `sourceIds` 建索引，便于后续检索。
- 去重与强制：同一 `factId` 在运行且未 `force` 时，直接复用已有任务。
- 事件通知：触发 `deepsearch.verify.started` / `deepsearch.verify.completed` / `deepsearch.verify.failed` 供上层监听。

## 返回语义

- 异步模式（默认）：返回任务已创建信息（含 `taskId`、当前状态、输入摘要）。
- 同步模式（`async=false`）：返回最终验证结果（含状态映射、摘要、详情、关联信源）。
- 去重命中：返回已存在任务信息，不重复创建。
- 失败路径：返回错误状态并触发失败事件，错误信息进入状态记录。

## 常见任务

发起交叉验证：
```javascript
await executeTool('cross-verify', {
  factId: 'fact-123',
  contradiction: 'A 文档称 2023 年，B 文档称 2024 年',
  sourceIds: ['doc-a', 'doc-b']
});
```

同步等待结果：
```javascript
await executeTool('cross-verify', {
  factId: 'fact-123',
  contradiction: '数据口径不一致',
  async: false,
  timeout: 300000
});
```

指定子代理类型：
```javascript
await executeTool('cross-verify', {
  factId: 'fact-123',
  contradiction: '指标定义冲突',
  subagent_type: 'analyzer'
});
```

强制重新验证：
```javascript
await executeTool('cross-verify', {
  factId: 'fact-123',
  contradiction: '新增证据后复核',
  force: true
});
```