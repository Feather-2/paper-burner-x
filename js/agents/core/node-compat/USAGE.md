# node-compat 使用指南

## 1. 基础用法

```javascript
import { createNodeEnv } from 'js/agents/core/node-compat';

const env = await createNodeEnv({
  cwd: '/workspace',
  env: { NODE_ENV: 'production' }
});

const result = await env.execute(`
  const fs = require('fs');
  fs.writeFileSync('/workspace/test.txt', 'Hello World');
  return 'done';
`);

await env.dispose();
```

---

## 2. 资源配额（防止失控）

```javascript
import { createNodeEnv } from 'js/agents/core/node-compat';

const env = await createNodeEnv({
  quota: {
    maxMemoryMB: 50,           // 最大内存 50MB
    maxNetworkRequests: 100,   // 最多 100 次网络请求
    maxFileWrites: 500,        // 最多 500 次文件写入
    maxFileReadsMB: 100        // 最多读取 100MB 文件
  }
});

try {
  await env.execute(`
    // 如果超过配额会抛出错误
    const http = require('http');
    for (let i = 0; i < 200; i++) {
      http.get('https://example.com'); // 第 101 次会失败
    }
  `);
} catch (error) {
  console.error(error.message); // "Network quota exceeded: 101 > 100"
}
```

---

## 3. 可观测性（实时监控）

```javascript
import { createNodeEnv, ObservabilityStream } from 'js/agents/core/node-compat';

const obsStream = new ObservabilityStream();

// 订阅所有事件
obsStream.subscribe((event) => {
  console.log(`[${event.type}]`, event.data, event.meta);
  // 示例输出:
  // [fs:writeFile] { path: '/test.txt', success: true } { duration: 5 }
  // [http:request] { url: 'https://api.example.com', success: true } { duration: 120 }
});

const env = await createNodeEnv({ observability: obsStream });

await env.execute(`
  const fs = require('fs');
  fs.writeFileSync('/test.txt', 'data'); // 触发 fs:writeFile 事件
`);
```

### UI 集成示例（React）

```jsx
function AgentMonitor() {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    const unsubscribe = obsStream.subscribe((event) => {
      setEvents(prev => [...prev.slice(-99), event]); // 保留最近 100 条
    });
    return unsubscribe;
  }, []);

  return (
    <div>
      {events.map((e, i) => (
        <div key={i}>
          <span>{new Date(e.timestamp).toLocaleTimeString()}</span>
          <span>{e.type}</span>
          <span>{JSON.stringify(e.data)}</span>
        </div>
      ))}
    </div>
  );
}
```

---

## 4. WASM 降级方案（CSP 兼容）

```javascript
import { createNodeEnv, selectExecutionMode } from 'js/agents/core/node-compat';

// 自动检测最佳执行模式
const mode = await selectExecutionMode({
  strictCSP: true  // 强制使用 WASM（不使用 eval）
});

console.log(`Using execution mode: ${mode}`); // "wasm"

const env = await createNodeEnv({
  sandboxLevel: mode  // 'wasm' | 'iframe' | 'eval'
});
```

### 手动检测可用模式

```javascript
import { detectAvailableModes } from 'js/agents/core/node-compat';

const modes = await detectAvailableModes();
console.log(modes); // ['wasm', 'iframe', 'eval']

if (!modes.includes('wasm')) {
  alert('WASM not supported, falling back to iframe');
}
```

---

## 5. 完整示例：生产级配置

```javascript
import {
  createNodeEnv,
  ObservabilityStream,
  selectExecutionMode
} from 'js/agents/core/node-compat';

// 1. 创建可观测流
const obsStream = new ObservabilityStream();
obsStream.subscribe((event) => {
  // 发送到监控系统
  analytics.track('agent_event', event);
});

// 2. 选择执行模式
const mode = await selectExecutionMode({
  strictCSP: window.location.hostname === 'production.example.com'
});

// 3. 创建环境
const env = await createNodeEnv({
  cwd: '/workspace',
  env: { NODE_ENV: 'production' },

  // 资源限制
  quota: {
    maxMemoryMB: 100,
    maxNetworkRequests: 200,
    maxFileWrites: 1000,
    maxFileReadsMB: 200
  },

  // 可观测性
  observability: obsStream,

  // 执行模式
  sandboxLevel: mode,

  // 超时
  timeout: 60000  // 60 秒
});

// 4. 执行代码
try {
  const result = await env.execute(`
    const axios = require('axios');
    const data = await axios.get('https://api.example.com/data');
    return data;
  `);

  console.log('Result:', result);
} catch (error) {
  console.error('Execution failed:', error);
} finally {
  await env.dispose();
}
```

---

## 6. npm 包管理

```javascript
import { createNodeEnv } from 'js/agents/core/node-compat';
import { PackageManager } from 'js/agents/core/node-compat/npm';

const env = await createNodeEnv();
const npm = new PackageManager({ vfs: env.vfs });

// 监听安装进度
npm.on('install:progress', ({ name, index, total }) => {
  console.log(`Installing ${name} (${index}/${total})`);
});

// 安装包
await npm.install('lodash', { version: '^4.17.0' });

// 使用已安装的包
await env.execute(`
  const _ = require('lodash');
  console.log(_.chunk([1, 2, 3, 4], 2)); // [[1, 2], [3, 4]]
`);
```

---

## 7. 事件类型参考

| 事件类型 | 数据字段 | 元数据 |
|---------|---------|--------|
| `fs:readFile` | `{ path, success }` | `{ duration }` |
| `fs:writeFile` | `{ path, success }` | `{ duration }` |
| `fs:mkdir` | `{ path, success }` | `{ duration }` |
| `fs:unlink` | `{ path, success }` | `{ duration }` |
| `http:request` | `{ url, method, success }` | `{ duration, statusCode }` |
| `code:execute` | `{ filename, success }` | `{ duration }` |

---

## 8. 错误处理

```javascript
try {
  await env.execute(code);
} catch (error) {
  if (error.message.includes('quota exceeded')) {
    // 配额超限
    console.error('Resource limit reached:', error);
  } else if (error.message.includes('timeout')) {
    // 超时
    console.error('Execution timeout:', error);
  } else if (error.message.includes('CSP')) {
    // CSP 阻止
    console.error('Content Security Policy violation:', error);
  } else {
    // 其他错误
    console.error('Execution error:', error);
  }
}
```
