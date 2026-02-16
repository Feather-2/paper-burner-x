# js/agents 重构路线图

Date: 2026-02-15
Update: 2026-02-16

## 状态
- ✅ Phase 1-4 全部完成
- ✅ 全部模块已达到 4★ 及以上
- ✅ 关联提交：`d25aa0a8`（Phase 1-4），`dd8530fe`（rename）

## 重构目标
重构目标已达成：已消除所有低于 4 星的模块。历史基线为 1 个 2 星模块（runtime/core）与 2 个 3 星模块（Design Stage、Core buses），当前全部模块均为 4 星及以上。

## ✅ Phase 1: runtime/core 重构 (2星→4星)

### ✅ 1.1 agent-loop.js — Mixin → 组合
Current architecture:
```
attachMessageHandling(BaseAgentLoop);  // line 392
attachToolDispatch(BaseAgentLoop);     // line 393
attachStatusMixin(BaseAgentLoop);      // line 394
attachStepMixin(BaseAgentLoop);        // line 395
attachPhaseMixin(BaseAgentLoop);       // line 396
attachUserActionMixin(BaseAgentLoop);  // line 397
```

Target architecture:
```javascript
class BaseAgentLoop {
  constructor({ messageManager, toolDispatcher, statusController, stepRunner, phaseRunner, userActionHandler }) {
    this._messages = messageManager;
    this._tools = toolDispatcher;
    this._status = statusController;
    this._steps = stepRunner;
    this._phases = phaseRunner;
    this._userActions = userActionHandler;
  }
}
```

Steps:
1. ✅ Extract each Mixin file's methods into standalone classes
2. ✅ Register each class in DI Container (`core/di/defaults.js`)
3. ✅ BaseAgentLoop constructor receives them via injection
4. ✅ Delete `attach*` functions and Mixin files
5. ✅ Update all subclasses (DefaultAgentLoop, DeepSearchAgentLoop, DesignAgentLoop, CodeSearchStage)

### ✅ 1.2 tool-registry.js — Resolver → DI
Current: 5 resolver functions probing context (lines 85-233)
Target: Constructor injection from DI Container

Steps:
1. ✅ Add constructor parameters: `{ emit, quotaManager, traceContext, schemaValidator }`
2. ✅ Remove `resolveEmit()`, `resolveToolQuotaManager()`, `resolveToolQuotaMode()`, `resolveTraceContext()`
3. ✅ Keep `resolveToolSchema()` as runtime lookup
4. ✅ Update all call sites to pass DI-resolved dependencies

### ✅ 1.3 MiddlewareChain + HookRegistry → 统一拦截
Target: HookRegistry becomes a middleware factory

Steps:
1. ✅ Create `createHookMiddleware(hookRegistry)` that wraps HookRegistry as middleware
2. ✅ Register it in the default MiddlewareChain at appropriate stages
3. ✅ Map PreToolUse hooks to BeforeTool stage middleware
4. ✅ Map PostToolUse hooks to AfterTool stage middleware
5. ✅ Map PreAgent/PostAgent hooks to BeforeAgent/AfterAgent stages
6. ✅ Convert Hook types (Command/Prompt/Agent) to middleware config
7. ✅ Deprecate direct HookRegistry usage in AgentLoop
8. ✅ Keep HookRegistry as internal implementation of the middleware

## ✅ Phase 2: Design Stage 重构 (3星→4星)

### ✅ 2.1 design-blackboard.js — 单体 → 组合
Current: 986-line monolithic class
Target: ~200-line thin composition layer over existing primitives

Mapping:
- slidePlans[] → StateBus path: design.plans.*
- generatedSlides[] → StateBus path: design.slides.*
- visualSlots[] → StateBus path: design.visuals.*
- styleRef → StateBus path: design.style
- version/rollback → Archive checkpoint: design:phase:{n}
- Concurrent editing → CRDT LWW-Map: slides/{id}/content
- Batch generation tasks → SharedTaskBoard: generate-slide-{id}

Steps:
1. ✅ Create `DesignState` class wrapping StateBus with Design-specific paths
2. ✅ Create `DesignCheckpoints` class wrapping Archive with phase semantics
3. ✅ Create `DesignBlackboard` facade composing DesignState + DesignCheckpoints
4. ✅ Migrate phase files to use new facade
5. ✅ Delete old monolithic blackboard

## ✅ Phase 3: Core 四总线优化 (3星→4星)

### ✅ 3.1 Archive 持久化改为防抖
Current: Every emit/set/call/request triggers queueMicrotask persistence
Target: Debounced batch persistence

Steps:
1. ✅ Add `_persistDebounceMs` config (default 500ms) to EventBus/StateBus/ServiceBus/MessageBus
2. ✅ Replace `queueMicrotask` with debounced timer
3. ✅ Add explicit `flush()` method for critical checkpoints
4. ✅ `Kernel.checkpoint()` calls `flush()` on all buses

### ✅ 3.2 背压精简
Current: _backpressure state has 8 fields including coalescePattern, deferNonCoalesced
Target: Simple queue + threshold drop

Steps:
1. ✅ Remove `coalescePattern` and `deferNonCoalesced` options
2. ✅ Simplify to queue + maxQueueSize + dropPolicy (oldest/newest)
3. ✅ Keep `requestAnimationFrame` scheduling for browser
4. ✅ Remove generation tracking (no longer needed without coalescing)

## ✅ Phase 4: 局部清理

### ✅ 4.1 Kernel getServices() 封装
✅ Add `ServiceBus.listServices()` public method and update Kernel to use it.

### ✅ 4.2 WorkerPool dispose()
✅ Add `ToolExecutor.dispose()` to remove pool entries from `globalThis` map.
✅ Finalized pool lifecycle ownership and cleanup path.

### ✅ 4.3 DegradationMatrix Promise 缓存
✅ Add: `this._degradationMatrixPromise = this._degradationMatrixPromise || initPromise`

### ✅ 4.4 renderPromptTemplate 去重
✅ Remove duplicate from `prompt-loader.js`, keep single source in `prompt-template.js`.

### ✅ 4.5 空 catch 块清理
✅ Continue governance with `logger.debug()` and intentional annotations.

## 实际收益

重构前:
```
⭐⭐⭐⭐⭐  18 modules (基础设施+安全+CRDT+contracts+DI+...)
⭐⭐⭐⭐   10 modules (plugins+sdk+stages+shared+...)
⭐⭐⭐     2 modules (Design Stage, Core buses)
⭐⭐       1 module  (runtime/core legacy)
```

重构后（实际）:
```
⭐⭐⭐⭐⭐  18 modules (保持不变)
⭐⭐⭐⭐   13 modules (原 2-3 星模块全部完成升级)
⭐⭐⭐     0 modules
⭐⭐       0 modules
```

全部模块已达到 4 星及以上，且顶部 5 星模块规模保持稳定。
