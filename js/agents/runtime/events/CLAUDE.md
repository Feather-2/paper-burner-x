# events - 事件类型

运行时事件定义。

## 核心文件

| 文件 | 职责 |
|------|------|
| `events.js` | 所有事件类型常量 |

## 事件类型

```javascript
// 运行时
RuntimeEvents = {
  STARTED: 'runtime:started',
  STOPPED: 'runtime:stopped',
  ERROR: 'runtime:error',
};

// Watchdog
WatchdogEvents = {
  WARNING: 'watchdog:warning',
  CRITICAL: 'watchdog:critical',
};

// Cicada 压缩
CicadaEvents = {
  COMPRESS_START: 'cicada:compress:start',
  COMPRESS_END: 'cicada:compress:end',
};

// DeepSearch
DeepSearchEvents = {
  TASK_START: 'deepsearch:task:start',
  TASK_END: 'deepsearch:task:end',
  FINDING: 'deepsearch:finding',
};

// Design
DesignEvents = {
  SLIDE_GENERATED: 'design:slide:generated',
  VISUAL_FILLED: 'design:visual:filled',
};

// Agent 生命周期
AgentLifecycleEvents = {
  STATUS_CHANGE: 'agent:status:change',
  STEP_START: 'agent:step:start',
  STEP_END: 'agent:step:end',
};

// 阶段
PhaseEvents = {
  ENTER: 'phase:enter',
  EXIT: 'phase:exit',
};
```
