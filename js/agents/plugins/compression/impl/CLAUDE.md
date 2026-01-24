# compression - 上下文压缩

Token 监控和上下文压缩，防止溢出。

## 核心文件

| 文件 | 职责 |
|------|------|
| `watchdog.js` | Watchdog - 运行健康监控/震荡检测 |
| `cicada-compressor.js` | CicadaCompressor - 渐进式压缩（分层 + 结构化摘要/归档 + schema 版本兼容） |
| `coordinator.js` | CompressionCoordinator - 压缩协调 |
| `compression-async.js` | 异步压缩 |
| `compression.worker.js` | Web Worker 压缩 |
| `context-predictor.js` | ContextPredictor - 回归预测剩余容量 |
| `adaptive-zone-manager.js` | AdaptiveZoneManager - 密度感知的动态区域边界（远模糊、近精确） |
| `proactive-compressor.js` | ProactiveCompressor - 主动压缩协调器 |
| `quality-monitor.js` | CompressionQualityMonitor - 压缩质量监控 |

## 主动上下文管理（Proactive Context Management）

基于"远模糊、近精确"和"在 Cache 内跳舞"策略的自适应上下文管理。

### 核心原则

1. **一次压到位** - 触发时压缩到 30%，避免反复压缩导致 KV cache 失效
2. **异步预生成** - 消息产生时异步生成摘要，压缩时直接使用
3. **按需检索** - 完整历史存 L3，AI 需要时 Recall 或 Subagent 查询
4. **Cache 友好** - 累积摘要只追加不修改，最大化 KV cache 命中率

### 上下文结构

```
[System Prompt]              ← 固定，cache 永久有效
[累积摘要 v1]                ← 只追加，不修改
[累积摘要 v2]                ← 追加
[活跃消息...]                ← 变化部分

↓ 压缩后

[System Prompt]              ← cache 命中 ✓
[累积摘要 v1]                ← cache 命中 ✓
[累积摘要 v2]                ← cache 命中 ✓
[累积摘要 v3]                ← 新追加
[新活跃消息...]              ← 变化部分
```

### AdaptiveZoneManager（动态分区）

自适应区域管理器按 fill ratio 将上下文分为四个 zone，并可根据“消息密度（tokens/message）”动态调整区域边界：

- Archive (默认 0-20%): 重度压缩，仅保留结论
- Condensed (默认 20-50%): 中度压缩，thinking → 决策点
- Working (默认 50-80%): 轻度压缩，保留 thinking
- Active (默认 80-100%): 无压缩，完整保留

关键配置：

- `defaultBoundaries`: `{ archive, condensed, working }`（0-1，单调递增）
- `densityWeight`: 密度调整权重（0-1）

`ProactiveCompressor` / `CompressionCoordinator` 通常基于 zone 来决定每一段消息采用“保留/摘要/归档”的强度。

### ProactiveCompressor

主动压缩协调器（90% 触发，压缩到 30%）：

```javascript
import { ProactiveCompressor } from 'js/agents/plugins/compression';
import { autoSelectPreset } from 'js/agents/plugins/compression/impl/proactive-compressor.js';

// 使用预设
const compressor = new ProactiveCompressor({
  contextWindow: 128000,
  preset: 'balanced',  // aggressive | balanced | conservative
});

// 或自动选择预设
const preset = autoSelectPreset(contextWindow);
const compressor2 = new ProactiveCompressor({ contextWindow, preset });

// 检查是否需要压缩
const { shouldCompress, fillRatio, zone } = compressor.shouldCompress(currentTokens);

// 执行主动压缩
const result = await compressor.compress(messages);
// result.messages - 压缩后的消息
// result.sessionSummary - 累积的会话摘要（只追加）
// result.archivedIds - 归档到 L3 的 ID 列表
// result.stats - 压缩统计（计数/比例等）
```

### CicadaCompressor（渐进式压缩）

`CicadaCompressor` 以“分层（layers）”方式逐步降低上下文体积，典型层级：

- `tool_output`
- `session_history`
- `llm_summary`

并支持结构化摘要的 schema version（用于前向兼容/灰度演进）。

常见配置点（见 Options typedef）：

- `maxTokens`: 压缩目标 token 上限
- `layers`: 启用的压缩层
- `archive`/`maxArchives`/`archiveRetentionDays`: 归档适配器与保留策略
- `eventBus`: 事件上报（用于质量监控/可观测性）
