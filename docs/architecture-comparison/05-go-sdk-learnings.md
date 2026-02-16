# 从 agentsdk-go 可借鉴的设计
Date: 2026-02-15
Source: ref/agentsdk-go-main

## 概述
agentsdk-go is a ~60 file, ~15K line Go Agent SDK. While js/agents exceeds it in functionality, there are specific design patterns worth adopting.

## 1. Agent 结构体的透明度

### Go 的做法
```go
type Agent struct {
    model        Model
    tools        ToolExecutor
    middleware   *Chain
    maxIter      int
}
```
Open agent.go and you see everything. No hidden methods, no dynamic injection.

### 建议
js/agents BaseAgentLoop should hold all capabilities as explicit instance properties (not Mixin-injected prototype methods). After refactoring agent-loop.js, the class declaration itself should reveal all capabilities.

## 2. 构造时依赖注入

### Go 的做法
```go
func New(model Model, tools []Tool, opts ...Option) (*Agent, error)
```
All dependencies passed at construction. No runtime probing.

### 建议
tool-registry.js should receive emit/quotaManager/traceContext at construction from DI Container, not probe them from context at every tool call. The DI system (core/di/) already exists and registers 70+ services.

## 3. 单一中间件链

### Go 的做法
```go
type Middleware interface {
    BeforeAgent(ctx, *State) error
    BeforeModel(ctx, *State) error
    AfterModel(ctx, *State) error
    BeforeTool(ctx, *State) error
    AfterTool(ctx, *State) error
    AfterAgent(ctx, *State) error
}
```
One chain, 6 stages, that's it. Every interception goes through the same pipeline.

### 建议
js/agents already has MiddlewareChain with same 6 stages. The remaining step is making HookRegistry a middleware within that chain, not a parallel system.

## 4. 错误短路

### Go 的做法
Middleware chain stops on first error. Tool execution returns error. Agent loop propagates error.

### 建议
js/agents hook-runner catches hook errors and only warns (tool-registry.js lines 429-441). Security-critical hooks (like command classification) should be able to short-circuit. The MiddlewareChain already supports this - another reason to unify.

## 5. Sandbox 策略分层

### Go 的做法
```go
FileSystemPolicy  // path whitelist + symlink detection
NetworkPolicy     // domain allowlist
ResourcePolicy    // CPU% / memory / disk limits
```
Clean three-layer policy model.

### 现状
js/agents actually exceeds this with actual code isolation (WASM/Browser/System sandboxes). But the POLICY layer is spread across safety/, hooks/, sandbox/network-policy-utils.js, and plugins/policy/. Consider consolidating policy checks into a unified PolicyMiddleware.

## 6. Session 互斥

### Go 的做法
```go
// sessionGate prevents concurrent Run/RunStream on same SessionID
if !rt.sessionGate.TryLock(req.SessionID) {
    return nil, ErrSessionBusy
}
```

### 建议
js/agents has TabCoordinator for cross-tab coordination, but no session-level mutex within a single tab. If two async operations try to run the same agent session concurrently, there's no protection. Consider adding a session lock in BaseAgentLoop.execute().

## 7. Hook 退出码语义

### Go 的做法
```
exit 0 = success (parse JSON stdout)
exit 2 = blocking error (stderr is message)
other  = non-blocking (log stderr, continue)
```
Simple, deterministic, easy to implement custom hooks.

### 现状
js/agents hook-runner already supports Command/Prompt/Agent hook types which are more powerful. But for shell-based hooks (if added), this exit code convention is worth adopting.

## 8. 流式优先

### Go 的做法
Internally always uses CompleteStream, converts to blocking Complete externally. Avoids proxy buffering issues.

### 建议
js/agents ModelRouter already supports streaming. Ensure all internal callers use streaming mode by default.

## 不需要借鉴的

Some Go patterns are NOT needed because js/agents already has better solutions:
- Go's lack of plugin system → js/agents PluginManager is more flexible
- Go's lack of persistence → js/agents Archive + CRDT + RunStore covers this
- Go's single-provider Model → js/agents multi-model routing is correct for browser use case
- Go's lack of CRDT → js/agents needs distributed state for multi-tab/multi-user scenarios
- Go's lack of sandboxed execution → js/agents WASM sandbox is essential for running untrusted Skills in browser
