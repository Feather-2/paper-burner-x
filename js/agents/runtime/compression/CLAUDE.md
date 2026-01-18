# compression - 上下文压缩

Token 监控和上下文压缩，防止溢出。

## 核心文件

| 文件 | 职责 |
|------|------|
| `watchdog.js` | Watchdog - Token 使用监控告警 |
| `cicada-compressor.js` | CicadaCompressor - 渐进式压缩 |
| `coordinator.js` | CompressionCoordinator - 压缩协调 |
| `compression-async.js` | 异步压缩 |
| `compression.worker.js` | Web Worker 压缩 |
| `context-predictor.js` | ContextPredictor - 回归预测剩余容量 |
| `adaptive-zone-manager.js` | AdaptiveZoneManager - 动态区域边界 |
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

### ProactiveCompressor

主动压缩协调器（90% 触发，压缩到 30%）：

```javascript
import { ProactiveCompressor, PROACTIVE_PRESETS, autoSelectProactivePreset } from 'js/agents/runtime';

// 使用预设
const compressor = new ProactiveCompressor({
  contextWindow: 128000,
  preset: 'balanced',  // aggressive | balanced | conservative
});

// 或自动选择预设
const preset = autoSelectProactivePreset(contextWindow);
const compressor = new ProactiveCompressor({ contextWindow, preset });

// 检查是否需要压缩
const { shouldCompress, fillRatio, zone } = compressor.shouldCompress(currentTokens);

// 执行主动压缩
const result = await compressor.compress(messages);
// result.messages - 压缩后的消息
// result.sessionSummary - 累积的会话摘要（只追加）
// result.archivedIds - 归档到 L3 的 ID 列表
// result.stats - 压缩统计 { kept, summarized, archived }
```

### 预设模式

| 预设 | targetFillRatio | keepLastTurns | compressThreshold | 适用场景 |
|------|-----------------|---------------|-------------------|----------|
| `aggressive` | 0.20 | 4 | 0.85 | 小窗口或紧急情况 |
| `balanced` | 0.30 | 6 | 0.90 | 默认推荐 |
| `conservative` | 0.50 | 10 | 0.92 | 大窗口或重要对话 |

### 预算分配算法

从最老消息开始，依次决定每条的策略：

```
budget >= 原文 tokens → keep（保留原文）
budget >= 摘要 tokens → summarize（用预生成摘要）
否则                  → archive（归档到 L3）
```

### 异步摘要预生成

MessageManager 自动为较长消息预生成摘要：

```javascript
import { MessageManager } from 'js/agents/runtime';

const mm = new MessageManager({
  asyncSummaryEnabled: true,  // 默认开启
  summaryGenerator: async (msg) => {
    // 自定义摘要生成器（可选，可使用 LLM）
    return await llm.summarize(msg.content);
  },
});

// 添加消息时自动触发异步摘要
mm.addMessage({ role: 'assistant', content: longContent });
// msg._summary 和 msg._summaryTokens 会被异步填充

// 动态配置
mm.setSummaryGenerator(customGenerator);
mm.setAsyncSummaryEnabled(false);
```

### ContextPredictor

回归预测剩余上下文容量：

```javascript
import { ContextPredictor } from 'js/agents/runtime';

const predictor = new ContextPredictor({
  contextWindow: 128000,
  windowSize: 20,      // 滑动窗口大小
  decayFactor: 0.9,    // 权重衰减因子
});

// 记录消息
predictor.record(message);

// 预测
const { fillRatio, zone, shouldCompress, predictedRemainingMessages } = predictor.predict();
```

### AdaptiveZoneManager

动态区域边界管理：

```javascript
import { AdaptiveZoneManager } from 'js/agents/runtime';

const zoneManager = new AdaptiveZoneManager({
  defaultBoundaries: { archive: 0.2, condensed: 0.5, working: 0.8 },
  densityWeight: 0.3,
});

// 获取消息的压缩策略
const { zone, config } = zoneManager.getCompressionStrategy(messageIndex, totalMessages, fillRatio);
// config.preserveThinking, config.summarizeThinking, config.compressionLevel
```

### Thinking 消息处理

CicadaCompressor 现支持 thinking 消息渐进摘要：

```javascript
const compressor = new CicadaCompressor({ ... });

// 启用 thinking 摘要（而非完全删除）
const result = compressor.compress(context, {
  summarizeThinking: true,           // 启用渐进摘要
  thinkingSummaryMaxChars: 150,      // 摘要最大字符数
});

// result.stats.summarizedThinking - 摘要的 thinking 消息数
// result.stats.removedThinking - 删除的 thinking 消息数（当 summarizeThinking=false）
```

## Watchdog

监控 Token 使用，触发告警：

```javascript
import { Watchdog } from 'js/agents/runtime/compression';

const watchdog = new Watchdog({
  maxTokens: 100000,
  warningThreshold: 0.8,
  criticalThreshold: 0.95,
});

watchdog.on('warning', ({ usage, limit }) => {
  console.log(`Token usage at ${usage}/${limit}`);
});

watchdog.track(messages);
```

## CicadaCompressor

渐进式上下文压缩：

```javascript
import { CicadaCompressor, CompressionLayer } from 'js/agents/runtime/compression';

const compressor = new CicadaCompressor({
  layers: [
    CompressionLayer.TOOL_OUTPUT,
    CompressionLayer.SESSION_HISTORY,
    CompressionLayer.LLM_SUMMARY,
  ],
});

const compressed = await compressor.compress(messages, { targetTokens: 50000 });
```

### 原子化规则 (Atomization)

`_compressWithLLM()` 内置 SimpleMem 论文的原子化策略，确保每条记忆独立可理解：

1. **指代消解 (Coreference Resolution)**
   - 代词 → 具体实体："他/她/它" → 实际名称
   - 指示词 → 具体对象："那个文件" → 实际文件名

2. **时间归一化 (Temporal Normalization)**
   - 相对时间 → ISO-8601："明天" → "2025-01-20"
   - 模糊时间 → 精确时间戳："刚才" → "2025-01-19T14:30:00Z"

3. **当前时间注入**
   - Prompt 中自动包含 `Current time: ${ISO-8601}` 供 LLM 参考

## CompressionCoordinator

协调 Watchdog + Compressor：

```javascript
import { CompressionCoordinator } from 'js/agents/runtime/compression';

const coordinator = new CompressionCoordinator({
  watchdog,
  compressor,
  autoCompress: true,
});

coordinator.attach(agentLoop);
```

## CompressionQualityMonitor

压缩质量监控，评估信息保留率：

```javascript
import { CompressionQualityMonitor } from 'js/agents/runtime';

const monitor = new CompressionQualityMonitor({
  minRetentionRatio: 0.7,    // 最小保留率阈值
  maxSamples: 100,           // 最大样本数
  trendWindowSize: 10,       // 趋势分析窗口
});

// 记录压缩结果
const { retention, belowThreshold } = monitor.record({
  beforeTokens: 10000,
  afterTokens: 8000,
  keptMessages: 5,
  summarizedMessages: 2,
  archivedMessages: 3,
});

// 获取质量评估
const assessment = monitor.getAssessment();
// { avgRetention, belowThresholdCount, trend: 'improving'|'stable'|'degrading', sampleCount }

// 健康检查
const health = monitor.checkHealth();
// { needsAdjustment, recommendation, status: 'healthy'|'warning'|'critical' }
```
