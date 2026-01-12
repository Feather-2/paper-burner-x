# 核心模块

Paper-Burner 的基础设施层，提供跨模块共享的核心能力。

## 模块职责

- **API 密钥管理**：KeyProvider
- **文件处理**：格式检测、ZIP 解压
- **并发控制**：Semaphore、ProcessQueue
- **状态管理**：DocumentStore、SelectionStore

## 子模块

| 子模块 | 路径 | 职责 |
|--------|------|------|
| api | `./api/` | API 密钥管理 |
| file | `./file/` | 文件工具、ZIP 处理 |
| processing | `./processing/` | 并发控制、任务队列 |
| state | `./state/` | 响应式状态管理 |

## 公开 API

```javascript
import {
  // API
  KeyProvider,
  // File
  SUPPORTED_EXTENSIONS,
  extractFilesFromZip,
  // Processing
  createSemaphore,
  ProcessQueue,
  // State
  createDocumentStore,
  createSelectionStore
} from 'js/core';
```

## 核心工具

### KeyProvider
安全的 API 密钥存储和访问。

### Semaphore
限制并发任务数量，防止资源耗尽。

### ProcessQueue
任务队列，支持优先级和取消。

### DocumentStore
响应式文档状态，自动触发 UI 更新。

## 与其他模块关系

```
js/core (基础设施)
    ↑
    ├── js/agents (使用 Semaphore、State)
    ├── js/ppt (使用 ProcessQueue)
    ├── js/chatbot (使用 KeyProvider)
    └── js/processing (使用 file utils)
```

## 开发注意

- 这里的代码被多个模块依赖，改动需谨慎
- 保持无副作用、纯函数风格
- 新增工具需考虑 ESM 兼容性
