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

## 关键默认值（impl）

- `AdaptiveZoneManager`
  - `defaultBoundaries`: `{ archive: 0.2, condensed: 0.5, working: 0.8 }`
  - `densityWeight`: `0.3`（会 clamp 到 0-1）
- `CicadaCompressor`
  - `maxTokens`: `2000`
  - `maxInputChars`: `12000`
  - `schemaVersion`: `1.0`（支持：`1.0` / `0.1` / legacy）
  - `layers`: `tool_output` / `session_history` / `llm_summary`

## 主动上下文管理（Proactive Context Management）

基于“远模糊、近精确”和“在 Cache 内跳舞”策略的自适应上下文管理。

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

#### 关键配置

- `defaultBoundaries`: `{ archive, condensed, working }`（0-1，单调递增；缺省字段回退到默认值）
- `densityWeight`: 密度调整权重（0-1，默认 `0.3`，会 clamp 到 0-1）

#### ZoneConfig（压缩决策载体）

`AdaptiveZoneManager` 内部以 `ZoneConfig` 作为“当前 fill ratio 应该怎么压”的结构化结果，典型字段：

- `name`: `archive|condensed|working|active`
- `start` / `end`: 区间范围（fill ratio）
- `compressionLevel`: 压缩级别描述
- `preserveThinking`: 是否保留 thinking
- `summarizeThinking`: 是否摘要 thinking

`ProactiveCompressor` / `CompressionCoordinator` 通常基于 zone 来决定每一段消息采用“保留/摘要/归档”的强度。

### CicadaCompressor（渐进式分层压缩）

`CicadaCompressor` 以 layer 为单位逐层压缩（如 tool 输出、会话历史、LLM 摘要），并支持结构化摘要/归档及 schema 版本兼容：

- `CompressionLayer`: `tool_output` / `session_history` / `llm_summary`
- 默认 `layers`: `tool_output` → `session_history` → `llm_summary`
- 默认 `maxTokens`: `2000`
- 默认 `maxInputChars`: `12000`（用于保护输入规模；具体策略以实现为准）
- `CICADA_SCHEMA_VERSION`: `1.0`
- `SUPPORTED_SCHEMA_VERSIONS`: `1.0` / `0.1` / legacy（无 version）

可选依赖（注入式）：

- `modelRouter`: `{ call?, chat? }`
- `archive`: `{ store?/set?/archive?/load?/get?/restore? }`
- `eventBus`: `{ emit? }`
- `maxArchives` / `archiveRetentionDays`: 控制归档数量与保留策略

### ProactiveCompressor

主动压缩协调器（90% 触发，压缩到 30%）：

```javascript
import { ProactiveCompressor } from 'js/agents/plugins/compression';
import { autoSelectPreset } from 'js/agents/plugins/compression/impl/proactive-compressor.js';

// 使用固定预设
const compressor = new ProactiveCompressor({
  contextWindow: 128000,
  preset: 'balanced',
});

// 或：按上下文窗口自动选择预设（具体签名以实现为准）
const preset = autoSelectPreset({ contextWindow: 128000 });
```
