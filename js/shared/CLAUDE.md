# js/shared - 共享模块

Paper-Burner 的跨模块共享基础设施层。

## 模块职责

- **core**: 事件总线、状态存储等核心抽象
- **adapters**: UI 适配器基类和通用适配器
- **utils**: 工具函数

## 目录结构

```
js/shared/
├── index.js           # 统一导出
├── core/
│   ├── index.js       # Core 模块入口
│   ├── event-bus.js   # UIEventBus - 事件发布订阅
│   └── state-store.js # StateStore - 通用状态管理
├── adapters/
│   ├── index.js           # Adapters 模块入口
│   ├── base-adapter.js    # BaseAdapter - 适配器基类
│   └── deepsearch-adapter.js # DeepSearch UI 适配器
└── utils/
    ├── escape-html.js  # HTML 转义
    ├── uuid.js         # UUID 生成
    └── logger.js       # 日志工具
```

## 公开 API

```javascript
import {
  // Core
  UIEventBus,
  getUIEventBus,
  resetUIEventBus,
  StateStore,
  getStateStore,
  resetStateStore,

  // Adapters
  BaseAdapter,
  DeepSearchAdapter,

  // Utils
  escapeHtml,
  generateUUID,
  uuid,
  createLogger
} from 'js/shared';
```

## 核心组件

### UIEventBus

统一的 UI 事件总线，支持：
- 精确匹配订阅
- 通配符订阅 (`*`, `prefix.*`)
- 事件历史记录

```javascript
const bus = getUIEventBus();

// 订阅
const off = bus.on('forge:new-node', (name, payload) => {
  console.log('New node:', payload);
});

// 通配符订阅
bus.on('forge.*', (name, payload) => {
  console.log('Forge event:', name);
});

// 发送
bus.emit('forge:new-node', { x: 10, y: 20 });

// 取消订阅
off();
```

### StateStore

通用状态管理，支持：
- 路径式访问 (`data.files`)
- 细粒度订阅
- 批量更新

```javascript
const store = getStateStore();

// 设置
store.set('ui.loading', true);

// 获取
const loading = store.get('ui.loading');

// 批量更新
store.update({
  'ui.loading': false,
  'data.result': { ... }
});

// 订阅
store.subscribe('data.*', (path, newValue, oldValue) => {
  console.log(`${path} changed`);
});
```

### BaseAdapter

UI 适配器基类，提供：
- 事件订阅管理
- 状态变化通知
- 资源清理

```javascript
import { BaseAdapter } from 'js/shared';

class MyAdapter extends BaseAdapter {
  constructor(eventBus, options) {
    super(eventBus, options);
  }

  start() {
    this._setState({ status: 'running' });
    this.subscribe('my:event', (name, payload) => {
      // 处理事件
    });
  }
}
```

## 与其他模块的关系

```
┌─────────────────────────────────────────────────────┐
│                    js/ppt                           │
│  ┌─────────────────────────────────────────────┐   │
│  │ ui-v2/core/state-store.js (PPT 特有状态)    │   │
│  │   └── uses getUIEventBus() from js/shared   │   │
│  └─────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────┐   │
│  │ ui-v2/adapters/agent-adapter.js (PPT 专用)  │   │
│  │   └── uses getUIEventBus(), getStateStore() │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│                   js/shared                         │
│  core/event-bus.js     ← 统一事件总线               │
│  core/state-store.js   ← 通用状态存储               │
│  adapters/base-adapter.js ← 适配器基类              │
│  adapters/deepsearch-adapter.js ← DeepSearch 适配器 │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│                  js/chatbot                         │
│  (可以直接使用 js/shared 的 EventBus 和 Adapters)   │
└─────────────────────────────────────────────────────┘
```

## 开发注意

- UIEventBus 和 StateStore 都提供全局单例 (`get*()`)
- 模块间通信优先使用 UIEventBus
- 业务特定的状态管理应在各模块内扩展 StateStore
- PPT 的 state-store.js 包含 workflow 业务逻辑，不应迁移到 shared
