# compression - 压缩插件

上下文压缩与监控插件集合，提供 Cicada 压缩服务和 Watchdog 自动触发，并通过 `index.js` 导出可复用的压缩实现与异步工具。

## 模块描述

- Cicada 插件注册 `compression` 服务，懒加载压缩器并记录压缩统计/事件。
- Watchdog 插件监控 token 使用率；超过阈值时在 `autoCompress=true` 时告警并可自动调用压缩（否则仅更新 health）。
- Watchdog 支持幂等安装：重复 install 时会先清理旧的 interval / listener，避免重复触发与资源叠加。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 模块出口：导出插件与核心实现（`impl/*`），以及异步压缩工具 |
| `cicada.js` | 注册 compression 服务；触发压缩事件；记录 lastCompression |
| `watchdog.js` | 监控 token 使用；阈值告警与自动压缩；暴露 watchdog 服务 |
| `impl/cicada-compressor.js` | `CicadaCompressor` 与 `CompressionLayer` 等核心压缩实现 |
| `impl/watchdog.js` | `Watchdog` 核心实现（被插件封装） |
| `impl/proactive-compressor.js` | `ProactiveCompressor`：基于策略的主动压缩 |
| `impl/coordinator.js` | `CompressionCoordinator`：多策略/多层压缩协调器 |
| `impl/adaptive-zone-manager.js` | `AdaptiveZoneManager`：自适应区间/窗口管理 |
| `impl/quality-monitor.js` | `CompressionQualityMonitor`：压缩质量监控与指标 |
| `impl/context-predictor.js` | `ContextPredictor`：上下文占用预测 |
| `impl/compression-async.js` | 异步压缩 worker：`compressSessionHistoryAsync` / `terminateCompressionWorker` / `isCompressionWorkerAvailable` |
| `impl/*` | 其他高级能力（预测、协调、监控、区间管理等） |

## 关键概念

- 服务接口：`compression.compress/shouldCompress/getStats`，`watchdog.check/getHealth`
- 事件（建议统一采用 `domain:action` 形式）：
  - `compression:done`、`compression:warning`
  - `watchdog:threshold.exceeded`（仅 `autoCompress=true` 时触发）
- 运行时数据：读取 `runtime.tokens` 与 `runtime.messages`，写入 `state.health` 与 `state.lastCompression`
- 监控触发：`checkInterval` 定时检查 + `runtime.tokens.*` 事件触发（约 1s 节流）
- 依赖关系：`compression/watchdog` 依赖 `compression/cicada`

## 常见任务

启用插件并配置阈值：

```javascript
import { Kernel } from 'js/agents/core';

const kernel = new Kernel();
await kernel.use('compression/cicada', { maxContextTokens: 120000, compressionRatio: 0.6 });
await kernel.use('compression/watchdog', { threshold: 0.8, autoCompress: true });
```

手动压缩一次：

```javascript
const result = await kernel.call('compression', 'compress', [messages], { targetTokens: 60000 });
```

手动检查健康状态：

```javascript
await kernel.call('watchdog', 'check');
const health = await kernel.call('watchdog', 'getHealth');
```

监听压缩/告警事件：

```javascript
kernel.events.on('compression:done', ({ originalCount, compressedCount, ratio }) => {
  console.log({ originalCount, compressedCount, ratio });
});
kernel.events.on('watchdog:threshold.exceeded', ({ usage, threshold }) => {
  console.log({ usage, threshold });
});
```

使用异步压缩 worker：

```javascript
import {
  compressSessionHistoryAsync,
  terminateCompressionWorker,
  isCompressionWorkerAvailable,
} from 'js/agents/plugins/compression/index.js';

if (isCompressionWorkerAvailable()) {
  const result = await compressSessionHistoryAsync(messages, { targetTokens: 60000 });
  console.log(result);
  terminateCompressionWorker();
}
```
