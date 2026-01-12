# plugins - 内置插件

Kernel 插件集合，按功能分类。

## 插件索引

### compression/ - 压缩

| 文件 | 插件 | 职责 |
|------|------|------|
| `cicada.js` | cicada | Cicada 上下文压缩 |
| `watchdog.js` | watchdog | Token 监控告警 |

### analysis/ - 分析

| 文件 | 插件 | 职责 |
|------|------|------|
| `fingerprint.js` | fingerprint | 内容指纹/去重 |

### debug/ - 调试

| 文件 | 插件 | 职责 |
|------|------|------|
| `inspector.js` | inspector | 运行时检查器 |
| `logger.js` | logger | 结构化日志 |

### resilience/ - 容错

| 文件 | 插件 | 职责 |
|------|------|------|
| `retry.js` | retry | 自动重试 |

### services/ - 服务

| 文件 | 插件 | 职责 |
|------|------|------|
| `llm.js` | llm | LLM 服务注册 |
| `mcp.js` | mcp | MCP 服务注册 |
| `scheduler.js` | scheduler | 调度器服务 |

### stages/ - 阶段

| 文件 | 插件 | 职责 |
|------|------|------|
| `deepsearch.js` | deepsearch | DeepSearch 阶段插件 |

## 使用示例

```javascript
import { Kernel } from 'js/agents/core';

const kernel = new Kernel();
await kernel.use('cicada', { threshold: 0.8 });
await kernel.use('watchdog', { maxTokens: 100000 });
await kernel.use('logger', { level: 'debug' });
```

## 创建自定义插件

```javascript
import { createPlugin } from 'js/agents/core';

export default createPlugin({
  name: 'my-plugin',
  version: '1.0.0',

  setup(ctx) {
    ctx.events.on('agent:step', handleStep);
    ctx.services.register('myService', myImpl);
  },

  teardown(ctx) {
    // cleanup
  }
});
```
