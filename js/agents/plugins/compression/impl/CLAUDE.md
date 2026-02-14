# compression/impl - 上下文压缩实现

负责 token 预测、压缩执行与质量反馈，目标是减少上下文溢出并降低压缩抖动。

## 核心文件

| 文件 | 职责 |
|------|------|
| `context-predictor.js` | 预测填充率与压缩触发时机 |
| `adaptive-zone-manager.js` | 动态分区边界（archive/condensed/working/active） |
| `proactive-compressor.js` | 主动压缩策略（预算分配 + 摘要/归档） |
| `quality-monitor.js` | 压缩质量健康检查与调整建议 |
| `cicada-compressor.js` | 分层压缩与 schema 兼容 |
| `coordinator.js` | 压缩协调入口 |

## ProactiveCompressor（最新变更）

### 触发与目标

- 默认在填充率 `0.90` 触发压缩，目标压到 `0.30`。
- `keepLastTurns` 默认 `6`，活跃区消息始终完整保留。
- 支持预设：`aggressive` / `balanced` / `conservative`，并支持基于 `contextWindow` 的 auto 选择。

### 预算分配策略

- 从最老消息开始，按预算做 `keep` / `summarize` / `archive` 决策。
- `summarize` 优先使用消息上的预生成摘要（`_summary`），否则即时摘要。
- `archive` 消息写入 L3（若存在 `memoryStore.archive`），并追加到 `sessionSummary`。

### QualityMonitor 接入（新增）

- 构造参数新增 `qualityMonitor`：
  - `true`：自动创建 `CompressionQualityMonitor`
  - `false`：禁用质量反馈
  - 实例：使用外部注入监控器
- `compress()` 完成后会记录统计并根据健康状态自动调参：
  - `critical`：`keepLastTurns +2`，`targetFillRatio +0.05`
  - `warning`：`keepLastTurns +1`，`targetFillRatio +0.02`
  - 所有调整都受上限约束（`keepLastTurns <= 20`，`targetFillRatio <= 0.70`）
- 新增 `getQualityReport()`；`getStats()` 现包含 `qualityMonitor` 健康结果。
- `configure({ qualityMonitor: false })` 可在运行时关闭质量反馈。

### 事件

- `compression:complete`：一次压缩完成后触发。
- `compression:quality-adjusted`：质量反馈触发自动调参时触发。
