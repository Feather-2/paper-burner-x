# api - StageApi 工厂

统一 StageApi 的创建与注入，减少 workflow 级别的手动参数传递，并提供默认的运行时保障（重试、熔断、配额、遥测）。

## 模块描述

- 面向各 Stage 的 API 构建器：`StageApiFactory` 统一注入服务并做必要的运行时增强
- 覆盖典型场景：基础 API、DeepSearch、Design、TextPrep
- 附带基础校验与兜底：必需字段检查、默认 TraceContext/ErrorBoundary/ToolQuotaManager/MessageBus、EventBus 回压
- Browser-first 适配：VFS → `fs`/`globFn`
- 运行时与高级服务透传：runtimeScheduler/pythonSkillExecutor/jsAdapter/hnswIndex/schemaValidator/deltaSyncSession/fileLock/tocBuilder，以及 policyManager/replayController/sharedMemoryBridge

## 核心文件

| 文件 | 职责 |
|------|------|
| `stage-api-factory.js` | StageApiFactory 与 createStageApiFactory；服务解析、默认配置、重试/遥测/回压等运行时增强 |

## 关键概念

| 概念 | 说明 |
|------|------|
| StageApiFactory | 统一创建 StageApi，减少参数散落；提供 `createBaseApi`/`createDeepSearchApi`/`createDesignApi`/`createTextPrepApi` |
| 服务解析顺序 | 显式传入 → `container.tryGet/get` → 默认实现（TraceContext/ErrorBoundary/ToolQuotaManager/MessageBus），MessageBus 可由 eventBus 自动构建 |
| 运行时增强 | EventBus 回压默认 `DEFAULT_EVENTBUS_BACKPRESSURE`、VFS → `fs`/`globFn` 适配、aiApiService token 追踪 + 熔断保护、aiApiService/mcpClient/externalSearchProvider 重试包装 |
| 运行时服务透传 | runtimeScheduler/pythonSkillExecutor/jsAdapter/hnswIndex/schemaValidator/deltaSyncSession/fileLock/tocBuilder |
| 高级能力透传 | policyManager/replayController/sharedMemoryBridge |
| 必需字段校验 | 基础需要 `signal`/`emit`；DeepSearch/Design 额外要求 `aiApiService`，缺失仅 warn 不抛异常 |
| 默认配额 | 内置 `DEFAULT_TOOL_QUOTAS`（search/search-docs/search.query/search.fetch） |

## 常见任务

### 1) 从 Workflow Context 创建 Factory

```javascript
import { StageApiFactory } from 'js/agents/runtime/api/stage-api-factory.js';

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
const factory = new StageApiFactory({
  container,
  retryStrategy,
  eventBusBackpressure: { maxQueueSize: 5000 },
  messageBus,
  toolQuotaManager,
});

const api = factory.createBaseApi({ aiApiService, mcpClient });
```

### 4) 注入运行时服务/高级能力

```javascript
const factory = new StageApiFactory({
  runtimeScheduler,
  pythonSkillExecutor,
  jsAdapter,
  policyManager,
  replayController,
});

const api = factory.createBaseApi();
```

### 5) Browser-first 适配

传入 `vfs` 后，Factory 会自动提供 `fs` 与 `globFn`，便于工具层统一使用。
