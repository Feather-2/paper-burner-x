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
    CompressionLayer.TRIM_WHITESPACE,
    CompressionLayer.SUMMARIZE_OLD,
    CompressionLayer.DROP_DETAILS,
  ],
});

const compressed = await compressor.compress(messages, { targetTokens: 50000 });
```

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
