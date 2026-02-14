# compression - 压缩插件

上下文压缩与监控插件集合，提供 Cicada 压缩服务和 Watchdog 自动触发，并通过 `index.js` 导出可复用的压缩实现与异步工具。

## 模块描述

- Cicada 插件注册 `compression` 服务，懒加载 `CicadaCompressor` 并记录压缩统计/事件。
- Cicada 使用内置阈值常量：`SHOULD_COMPRESS_RATIO = 0.8`、`WARNING_RATIO = 0.9`，用于建议压缩与告警判定。
- Watchdog 插件监控 token 使用率；超过阈值时在 `autoCompress=true` 时告警并可自动调用压缩（否则仅更新 health）。
- Watchdog 支持幂等安装：重复 `install` 时会先执行 `ctx._watchdogCleanup`，清理旧 interval / listener，避免重复触发与资源叠加。
- `watchdog.js` 额外导出 `Watchdog` 实现，便于插件外按需复用。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 模块出口：导出插件与核心实现（`impl/*`），以及异步压缩工具 |
| `cicada.js` | 注册 `compression` 服务；触发压缩事件；记录 `lastCompression` |
| `watchdog.js` | 监控 token 使用；阈值告警与自动压缩；暴露 `watchdog` 服务；导出 `Watchdog` |
| `impl/cicada-compressor.js` | `CicadaCompressor` 与 `CompressionLayer` 等核心压缩实现 |
| `impl/watchdog.js` | `Watchdog` 核心实现（被插件封装） |
| `impl/proactive-compressor.js` | `ProactiveCompressor`：基于策略的主动压缩 |
| `impl/coordinator.js` | `CompressionCoordinator`：多策略/多层压缩协调器 |
| `impl/adaptive-zone-manager.js` | `AdaptiveZoneManager`：自适应区间/窗口管理 |
| `impl/quality-monitor.js` | `CompressionQualityMonitor`：压缩质量监控与指标 |
| `impl/context-predictor.js` | `ContextPredictor`：上下文占用预测 |
| `impl/compression-async.js` | 异步压缩 worker：`compressSessionHistoryAsync` / `terminateCompressionWorker` / `isCompressionWorkerAvailable` |

## 关键概念

- 服务接口：`compression.compress/shouldCompress/getStats`，`watchdog.check/getHealth`
- 事件（建议统一采用 `domain:action` 形式）：
  - `compression:done`
  - `compression:warning`
  - `watchdog:threshold:exceeded`（仅 `autoCompress=true` 时触发）
- 运行时数据：读取 `runtime.tokens` 与 `runtime.messages`，写入 `state.health` 与 `state.lastCompression`
- 监控触发：`checkInterval` 定时检查 + `runtime.tokens.*` 事件触发（约 1s 节流）
- 清理机制：Watchdog 在上下文挂载 `ctx._watchdogCleanup`，用于重复安装或卸载时释放资源
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
const result = await kernel.call('compression', 'compress', [messages], { targetTokens: 6000 });
```

获取当前健康状态：

```javascript
const health = await kernel.call('watchdog', 'getHealth');
```