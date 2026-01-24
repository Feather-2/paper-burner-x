# api - StageApi 工厂

统一 StageApi 的创建与注入，减少 workflow 级别的手动参数传递，并提供默认的运行时保障（重试、熔断、配额、遥测）。

## 模块描述

- 面向各 Stage 的 API 构建器：`StageApiFactory` 统一注入服务并做必要的运行时增强
- 覆盖典型场景：基础 API、DeepSearch、Design、TextPrep
- 附带基础校验与兜底：必需字段检查、默认 TraceContext/ErrorBoundary/ToolQuotaManager/MessageBus、EventBus 回压
- Browser-first 适配：通过 VFS adapter 提供 `fs`/`globFn` 能力，避免直接依赖 Node-only API
- 遥测与限流：全局 token tracker + TraceContext span 包装；配额由 ToolQuotaManager 统一管理
- 可观测性：模块级 `logger`（`runtime/api/stage-api-factory`）用于关键告警与降级路径记录
- 运行时与高级服务透传：runtimeScheduler/pythonSkillExecutor/jsAdapter/hnswIndex/schemaValidator/deltaSyncSession/fileLock/tocBuilder，以及 policyManager/replayController/sharedMemoryBridge

## 核心文件

| 文件 | 职责 |
|------|------|
| `stage-api-factory.js` | StageApiFactory 与 createStageApiFactory；服务解析、默认配置、重试/熔断/遥测/回压等运行时增强 |

## 主要类型（JSDoc）

| 类型 | 用途 |
|------|------|
| `ServiceContainerLike` | DI 容器最小接口：`get`/`tryGet` |
| `EventBusLike` / `EventBusBackpressureConfig` | 事件总线与回压配置 |
| `TraceContextLike` | TraceSpan 生命周期与上下文透传 |
| `RetryStrategyLike` | 统一重试策略（支持 AbortSignal） |
| `ErrorBoundaryLike` | 统一错误边界包装 |

## 关键概念

| 概念 | 说明 |
|------|------|
| StageApiFactory | 统一创建 StageApi，减少参数散落；提供 `createBaseApi`/`createDeepSearchApi`/`createDesignApi`/`createTextPrepApi` |
| 服务解析顺序 | 显式传入 → `container.tryGet/get` → 默认实现（TraceContext/ErrorBoundary/ToolQuotaManager/MessageBus）；`MessageBus` 可由 `eventBus` 自动构建 |
| 运行时增强 | EventBus 回压默认 `DEFAULT_EVENTBUS_BACKPRESSURE`；VFS → `fs`/`globFn` 适配；token 追踪 + 熔断保护；对关键外部依赖做重试包装（如 `aiApiService`/`mcpClient`/`externalSearchProvider`） |
| 必需字段校验 | 基础需要 `signal`/`emit`；DeepSearch/Design 额外要求 `aiApiService`（缺失仅 warn，不抛异常） |
| 默认配额 | 内置 `DEFAULT_TOOL_QUOTAS`（`search`/`search-docs`/`search.query`/`search.fetch`） |

## 常见任务

### 1) 从 Workflow Context 创建 Factory

```javascript
import { StageApiFactory } from 'js/agents/runtime/core/api/stage-api-factory.js';

const factory = StageApiFactory.fromWorkflowContext(ctx);
const api = factory.createBaseApi();
```

### 2) 创建 DeepSearch / Design / TextPrep 专用 API

```javascript
const deepApi = factory.createDeepSearchApi();
const designApi = factory.createDesignApi();
const textPrepApi = factory.createTextPrepApi();
```
