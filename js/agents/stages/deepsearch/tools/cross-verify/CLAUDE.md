# cross-verify - 交叉验证工具

用于在 DeepSearch 阶段对冲突信息进行交叉核实，启动专项子任务比对多来源证据，并把结果写回黑板/状态。

## 模块描述

cross-verify 会基于 factId 和冲突描述启动子代理核查任务，收集证据、解析核查报告并更新 Discovery 状态，同时把摘要和详情写入 sharedContext/state，便于后续跟踪。支持同步等待结果并设置超时。

## 核心文件

| 文件 | 说明 |
|------|------|
| `handler.js` | 工具入口与完整流程：证据收集、任务启动、结果解析、状态回写 |

## 关键概念

- 事实与冲突：`factId` 与 `contradiction` 为必填；`sourceIds` 可限定信源范围。
- 输入兼容：`sources`/`sourceId` 作为 `sourceIds` 别名；`subagentType` 作为 `subagent_type` 别名。
- 证据收集：优先从 `sharedContext.search('evidence:${factId}')` 获取证据，再用 `sharedContext.getDetail` 拉详情；无结果时回退到 `DiscoveryManager.getEvidences`。
- 信源推断：未提供 `sourceIds` 时，从证据中推断 `sourceIds` 供子任务使用。
- 子任务核查：使用 `task` 工具创建专项子任务，`subagent_type` 默认 `researcher`，始终异步启动；当 `async=false` 时等待任务完成（默认超时 600000ms）。
- 结论解析：要求子任务报告首段包含 JSON；`status` 映射到 `DiscoveryStatus`（SATISFIED/CONTRADICTED/PARTIAL/BLOCKED）。
- 状态与黑板：运行中与完成后的记录写入 `state` scratchpad 的 `crossVerify`，并写入 `sharedContext` 的 `cross_verify:${factId}` 指针与索引；完成后写入 `sharedContext.setSummary('verification', ...)` 并发送 `sharedContext.signal('verification', ...)`。
- 去重与强制：若同一 `factId` 已在运行且未 `force`，直接返回已有任务。
- 事件通知：触发 `deepsearch.verify.started/completed/failed` 事件便于上层监听。

## 常见任务

发起交叉验证：
```javascript
await executeTool('cross-verify', {
  factId: 'fact-123',
  contradiction: 'A 文档称 2023 年，B 文档称 2024 年',
  sourceIds: ['doc-a', 'doc-b'],
});
```

同步等待结果：
```javascript
await executeTool('cross-verify', {
  factId: 'fact-123',
  contradiction: '数据口径不一致',
  async: false,
  timeout: 300000,
});
```

指定子代理类型（兼容字段）：
```javascript
await executeTool('cross-verify', {
  factId: 'fact-123',
  contradiction: '数据口径不一致',
  sources: 'doc-a',
  subagentType: 'analyzer',
});
```

获取结果与摘要：
- `get-task-result { taskId, wait: true }`
- `sharedContext.getDetail('cross_verify:${factId}')`
- `state` 的 `scratchpad.crossVerify[factId]`