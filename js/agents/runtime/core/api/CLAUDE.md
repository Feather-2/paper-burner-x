# api - StageApi 工厂

统一 StageApi 的创建与注入，减少 workflow 级别的手动参数传递，并提供默认运行时保障（重试、熔断、配额、遥测、消息总线兜底）。

## 模块描述

- 面向各 Stage 的 API 构建器：`StageApiFactory` 统一注入服务并做运行时增强
- 覆盖典型场景：基础 API、DeepSearch、Design、TextPrep
- 核心逻辑拆分为 `factory + helpers`：`stage-api-factory.js` 负责组装，`stage-api-helpers.js` 负责解析与防御性增强
- Browser-first 适配：通过 VFS adapter 提供 `fs` 与 `globFn`，避免直接依赖 Node-only API
- 遥测与可靠性：全局 token tracker、Trace span 包装、Retry 包装与熔断注册
- 可观测性：模块级 `logger`（`runtime/api/stage-api-factory`）记录告警与降级路径

## 核心文件

| 文件 | 职责 |
|------|------|
| `stage-api-factory.js` | `StageApiFactory` 与 `createStageApiFactory`；整合容器服务、创建不同 Stage API、注入运行时能力 |
| `stage-api-helpers.js` | 服务解析与安全兜底：trace/retry/error boundary/quota/message bus 解析，EventBus 回压与外部服务重试包装 |

## 主要类型（JSDoc）

| 类型 | 用途 |
|------|------|
| `ServiceContainerLike` | DI 容器最小接口：`get` / `tryGet` |
| `EventBusLike` / `EventBusBackpressureConfig` | 事件总线抽象与回压配置 |
| `TraceContextLike` | Trace span 生命周期与上下文透传 |
| `RetryStrategyLike` | 统一重试策略（支持 `AbortSignal`） |
| `ErrorBoundaryLike` | 错误边界包装接口 |

## 关键概念

| 概念 | 说明 |
|------|------|
| StageApiFactory | 统一创建 Stage API，减少参数散落；提供 `createBaseApi` / `createDeepSearchApi` / `createDesignApi` / `createTextPrepApi` |
| 服务解析顺序 | 显式传入 → `container.tryGet/get` → 默认实现（TraceContext/ErrorBoundary/ToolQuotaManager/MessageBus） |
| 运行时增强 | EventBus 回压默认 `DEFAULT_EVENTBUS_BACKPRESSURE`；`aiApiService` token 追踪与重试包装；`mcpClient` 重试包装；熔断器统一注册 |
| Browser-first IO | 通过 `createFsAdapterFromVfs` 与 `createVfsGlobFn` 从 VFS 派生 `fs` 与 `globFn` |
| 必需字段校验 | 基础 API 需要 `signal` 与 `emit`；特定 Stage 可附加额外依赖校验 |
| 配额治理 | 由 `ToolQuotaManager` 统一管理默认与覆盖配额 |

## Helper 能力索引（`stage-api-helpers.js`）

- `filterDefinedValues`：过滤 `undefined/null`，避免覆盖有效配置
- `resolveTraceContext`：从参数或容器解析 TraceContext，缺省回退到内置实现
- `resolveRetryStrategy`：构建统一重试策略，支持中断信号
- `resolveErrorBoundary`：解析或创建错误边界实例
- `resolveToolQuotaManager`：注入或创建配额管理器
- `resolveMessageBus`：优先使用显式 MessageBus，缺省可由 EventBus 构造
- `ensureEventBusBackpressure`：开启并规范 EventBus 回压配置
- `ensureAiApiServiceTokenTracking`：为 `aiApiService` 注入 token 追踪
- `ensureAiApiServiceRetry`：为 `aiApiService` 注入重试
- `ensureMcpClientRetry`：为 `mcpClient` 注入重试

## 常见任务

### 1) 从 Workflow Context 创建 Factory

```javascript
import { StageApiFactory } from 'js/agents/runtime/core/api/stage-api-factory.js';

const factory = StageApiFactory.fromWorkflowContext(ctx);
const api = factory.createBaseApi();
```

### 2) 创建 DeepSearch API 并覆盖默认配置

```javascript
const deepSearchApi = factory.createDeepSearchApi({
  quotas: { search: 8, 'search.query': 6 },
  backpressure: { maxQueueSize: 5000 }
});
```

### 3) 使用函数式入口创建 Factory

```javascript
import { createStageApiFactory } from 'js/agents/runtime/core/api/stage-api-factory.js';

const factory = createStageApiFactory({ container, eventBus, signal, emit });
```

## 维护约定

- 保持 ES Modules 与 JSDoc 风格，不引入 TypeScript 编译依赖
- 新增外部服务接入时，优先在 helper 层补齐重试、熔断、遥测与限流包装
- Stage API 的新增字段必须经过 `filterDefinedValues` 或等价防御性过滤
- Browser-first：禁止在本模块直接引入 Node-only API（如 `fs`、`path`、`process`）
