# compression - 压缩插件

上下文压缩与监控插件集合，提供 Cicada 压缩服务和 Watchdog 自动触发。

## 模块描述

- Cicada 插件注册 `compression` 服务，懒加载压缩器并记录压缩统计/事件。
- Watchdog 插件监控 token 使用率；超过阈值时在 autoCompress=true 时告警并可自动调用压缩（否则仅更新 health）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `cicada.js` | 注册 compression 服务；触发压缩事件；记录 lastCompression |
| `watchdog.js` | 监控 token 使用；阈值告警与自动压缩；暴露 watchdog 服务 |

## 关键概念

- 服务接口：`compression.compress/shouldCompress/getStats`，`watchdog.check/getHealth`
- 事件：`compression.done`、`compression.warning`、`watchdog.threshold.exceeded`（仅 autoCompress=true 时触发）
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
kernel.events.on('compression.done', ({ originalCount, compressedCount, ratio }) => {
  console.log({ originalCount, compressedCount, ratio });
});
kernel.events.on('watchdog.threshold.exceeded', ({ usage, threshold }) => {
  console.log({ usage, threshold });
});
```