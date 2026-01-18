# debug - 调试插件

运行时检查与日志输出，面向开发/排障。

> **文件统计**: 2 个 JS 文件

## 模块描述

`plugins/debug` 提供两类调试能力：`debug/inspector` 暴露内核运行态检查 API，并可选挂载到 `globalThis`；`debug/logger` 监听事件与状态变化并输出结构化日志，同时保留内存缓冲，适合本地开发或问题定位。

## 核心文件

| 文件 | 职责 |
|------|------|
| `inspector.js` | 运行时检查器服务：内核/事件/状态/服务/插件信息 |
| `logger.js` | 调试日志：事件与状态变更记录、日志缓冲 |

## 关键概念

- **Inspector 服务**: `kernel.services.get('inspector')` 获取，包含 `kernel/events/state/services/plugins` 子域；`help()` 输出 API 速查表。
- **内核检查**: `kernel.status/snapshot/healthCheck` 提供状态、快照与健康检查。
- **事件工具**: `events.history/emit/waitFor` 用于查询历史、发射事件与等待模式事件。
- **状态工具**: `state.get/set/snapshot/rollback/changeLog` 支持读写、快照与回滚。
- **服务调用**: `services.list/call/stats` 用于列出服务、调用方法与查看统计。
- **全局暴露**: `exposeGlobal=true` 时挂载 `globalThis.__kernelInspector`。
- **Logger 配置**: `level/pretty/includeTimestamp/includeEventData/maxDataLength/maxBuffer` 控制输出格式与缓冲大小。
- **缓冲与裁剪**: 默认 `maxBuffer=200`，事件数据按 `maxDataLength` 截断；缓冲条目包含 `{ level, event, data, timestamp }`。

## 常见任务

```javascript
import { Kernel } from 'js/agents/core';

// 开发预设：默认启用 debug/inspector 与 debug/logger
const kernel = await Kernel.create('development');
```

```javascript
import { Kernel } from 'js/agents/core';

const kernel = new Kernel();
await kernel.use('debug/inspector', { exposeGlobal: true });
await kernel.use('debug/logger', { level: 'info', pretty: true, includeEventData: false });
await kernel.start();
```

```javascript
const inspector = await kernel.services.get('inspector');
const status = inspector.kernel.status();
const events = inspector.events.history('kernel.');
const waited = await inspector.events.waitFor('kernel.started', 500);
inspector.help();
```

```javascript
const logger = await kernel.services.get('logger');
const buffer = logger.getBuffer();
logger.clearBuffer();
```
