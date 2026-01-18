# tokenizers - Token 计数

提供自适应 Token 计数器：先用启发式估算，WASM tiktoken 可用时自动升级，失败则保持回退。

## 模块描述

用于在不同运行环境下可靠地估算或精确计算 Token 数量，并支持按需初始化、状态查询与资源释放。

## 核心文件

| 文件 | 职责 |
|------|------|
| `adaptive-token-counter.js` | createAdaptiveTokenCounter, getGlobalTokenCounter |

## 关键概念

- 自适应计数：`count()` 立即返回估算，后台尝试初始化 tiktoken。
- 输入转换：`count()` 接受任意值，`null/undefined` 计 0；其余值优先 `JSON.stringify`，失败回退 `String()`。
- WASM 初始化：`init()` 为 best-effort；不支持 WASM 或加载失败会永久回退。
- 加载策略：优先 `import("tiktoken")`，失败回退 `@dqbd/tiktoken`。
- 编码选择：优先 `encoding`，其次 `model`，最后默认 `o200k_base` → `cl100k_base`。
- 日志钩子：可提供 `onLog` 处理 init 失败等告警；默认使用 `console.warn/error`。
- 预热策略：`warmup` 默认 true；`warmupIdleMs` 可延迟 warmup 以避开关键路径。
- 状态与释放：`getStatus()` 查看 `mode/ready/failed`，`dispose()` 释放 WASM 资源。
- 全局实例：`getGlobalTokenCounter()` 基于 DI 容器注册（已标记 deprecated）。

## 常见任务

```javascript
import { createAdaptiveTokenCounter } from 'js/agents/shared/tokenizers';

const counter = createAdaptiveTokenCounter({ model: 'gpt-4o-mini', warmup: true });
const tokens = counter.count('Hello world');
// 首次多为启发式估算，WASM 就绪后自动升级
```

```javascript
await counter.init({ model: 'gpt-4o-mini' });
const { mode, ready, failed } = counter.getStatus();
```

```javascript
const counter = createAdaptiveTokenCounter({
  encoding: 'cl100k_base',
  warmupIdleMs: 1000,
});
```

```javascript
const counter = createAdaptiveTokenCounter({
  warmup: false,
  onLog: ({ level, message, error }) => {
    // 将告警转发到自定义日志系统
  },
});
```

```javascript
counter.dispose();
```

如需全局共享实例，可用 `getGlobalTokenCounter()`；更推荐通过 DI 容器获取 `ServiceId.TOKEN_COUNTER`。