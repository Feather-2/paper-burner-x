# compression - 上下文压缩

Token 监控和上下文压缩，防止溢出。

## 核心文件

| 文件 | 职责 |
|------|------|
| `watchdog.js` | Watchdog - 运行健康监控/震荡检测 |
| `cicada-compressor.js` | CicadaCompressor - 渐进式压缩（分层 + 结构化摘要/归档 + schema 版本兼容 + 安全解析） |
| `cicada-helpers.js` | 压缩辅助函数（消息归一化、摘要、裁剪、键过滤） |
| `coordinator.js` | CompressionCoordinator - 压缩协调 |
| `compression-async.js` | 异步压缩 |
| `compression.worker.js` | Web Worker 压缩 |
| `context-predictor.js` | ContextPredictor - 回归预测剩余容量 |
| `adaptive-zone-manager.js` | AdaptiveZoneManager - 密度感知的动态区域边界（远模糊、近精确） |
| `proactive-compressor.js` | ProactiveCompressor - 主动压缩协调器 |
| `quality-monitor.js` | CompressionQualityMonitor - 压缩质量监控 |

## 关键默认值（impl）

- `AdaptiveZoneManager`
  - `DEFAULT_BOUNDARIES`: `{ archive: 0.2, condensed: 0.5, working: 0.8 }`（冻结对象）
  - `densityWeight`: `0.3`（会 clamp 到 0-1）
  - `_zoneDensities`: `{ archive, condensed, working, active }`（区域密度状态）
- `CicadaCompressor`
  - `maxTokens`: `2000`
  - `maxInputChars`: `12000`
  - `schemaVersion`: `1.0`（支持：`1.0` / `0.1` / legacy）
  - `layers`: `tool_output` / `session_history` / `llm_summary`
  - 安全辅助：`robustParseJson`、`createSafeRegex`、`makeSecureTimestampedId`

## 主动上下文管理（Proactive Context Management）

基于远模糊、近精确与 Cache 友好的自适应上下文管理。

### 核心原则

1. 一次压到位：触发时压缩到约 30%，避免频繁压缩导致 KV cache 失效
2. 异步预生成：消息产生时异步生成摘要，压缩时优先复用
3. 按需检索：完整历史存入归档层，需要时 Recall 或 Subagent 查询
4. 累积摘要只追加：不回写旧摘要，最大化 cache 命中率

### AdaptiveZoneManager（动态分区）

按 fill ratio 将上下文分为四个 zone，并根据消息密度（tokens/message）动态调整边界：

- Archive（默认 0-20%）：重度压缩，仅保留结论
- Condensed（默认 20-50%）：中度压缩，thinking → 决策点
- Working（默认 50-80%）：轻度压缩，保留 thinking
- Active（默认 80-100%）：无压缩，完整保留

#### 关键配置

- `defaultBoundaries`：`{ archive, condensed, working }`（0-1、单调递增）
- `densityWeight`：密度调整权重（0-1，默认 `0.3`，构造时 clamp）

#### ZoneConfig（压缩决策载体）

- `name`：`archive | condensed | working | active`
- `start/end`：区域起止 fill ratio
- `compressionLevel`：压缩级别描述
- `preserveThinking`：是否保留 thinking 原文
- `summarizeThinking`：是否将 thinking 摘要化

### CicadaCompressor（分层压缩）

- 支持 tool output、session history、LLM summary 三层压缩
- 处理 tool-call 成对关系并清理孤儿消息
- schema 兼容 `1.0`、`0.1` 与 legacy
- 压缩失败时回退到 fallback summary，保证流程可用

## 维护约定

- 事件名保持 `domain:action`
- 新增压缩层时同步更新默认 `layers` 与 schema 兼容逻辑
- 修改分区策略时同步校验边界单调性、密度权重与 `_zoneDensities` 更新逻辑
