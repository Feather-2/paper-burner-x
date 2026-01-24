# api - StageApi 工厂

统一 StageApi 的创建与注入，减少 workflow 级别的手动参数传递，并提供默认的运行时保障（重试、熔断、配额、遥测）。

## 模块描述

- 面向各 Stage 的 API 构建器：`StageApiFactory` 统一注入服务并做必要的运行时增强
- 覆盖典型场景：基础 API、DeepSearch、Design、TextPrep
- 附带基础校验与兜底：必需字段检查、默认 TraceContext/ErrorBoundary/ToolQuotaManager/MessageBus、EventBus 回压
- Browser-first 适配：通过 VFS adapter 提供 `fs`/`globFn` 能力，避免直接依赖 Node-only API
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
| 运行时增强 | EventBus 回压默认 `DEFAULT_EVENTBUS_BACKPRESSURE`；VFS → `fs`/`globFn` 适配；`aiApiService` token 追踪 + 熔断保护；对关键外部依赖做重试包装（如 `aiApiService`/`mcpClient`/`externalSearchProvider`） |
| 必需字段校验 | 基础需要 `signal`/`emit`；DeepSearch/Design 额外要求 `aiApiService`（缺失仅 warn，不抛异常） |
| 默认配额 | 内置 `DEFAULT_TOOL_QUOTAS`（`search`/`search-docs`/`search.query`/`search.fetch`） |

## 常见任务

### 1) 从 Workflow Context 创建 Factory

```javascript
import { StageApiFactory } from 'js/agents/runtime/core/api/stage-api-factory.js';

const factory = StageApiFactory.fromWorkflowContext(ctx);
const api = factory.createBaseApi();
```

### 2) 创建 DeepSearch / Design 专用 API

```javascript
const deepApi = factory.createDeepSearchApi();
const designApi = factory.createDesignApi({ imageProvider, svgGenerator });
```

### 3) 自定义重试/回压/依赖注入

```javascript
import { StageApiFactory } from 'js/agents/runtime/core/api/stage-api-factory.js';

const factory = new StageApiFactory({
  container,
  retryStrategy,
  eventBusBackpressure: {
    maxQueueSize: 1000,
    coalescePattern: /^(agent:step|tool:call)/,
    deferNonCoalesced: true
  }
});

const api = factory.createBaseApi({ signal });
```

## 安全与稳定性注意事项

- 工具参数校验：对工具调用入口做 schema 校验，避免未验证对象直接透传到工具实现
- Hook 链鲁棒性：pre/post hooks 异常应被 ErrorBoundary 捕获并记录，不应意外中断主流程（除非显式配置）
- 配置合并安全：合并外部配置对象时过滤 `__proto__`/`prototype`/`constructor`，避免原型污染
- 外部请求约束：对可控 URL 增加 allowlist/协议限制 + 超时/AbortSignal，降低 SSRF 风险
- 资源与并发：确认重试/熔断不会放大并发；MessageBus/EventBus 的队列与定时器应可回收

## 测试建议

- 工具调用边界条件（空值/边界值/类型边界）
- Hook 异常处理（pre/post 抛错不应吞掉或打断主流程）
- 资源/内存压力（EventBus 队列上限、MessageBus 清理、重复创建 factory 的泄漏检查）
