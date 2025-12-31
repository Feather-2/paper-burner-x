# Analysis: SDK & Lifecycle (SDK 与生命周期)

## 1. 架构 (Architecture)

### 流式构建器 (`js/agents/sdk/`)
- **`AgentBuilder`**: 提供了高度抽象的链式配置 API。它负责组装 `Capability`, `Hook`, `MCP`, `EventBus`, `Cicada` (压缩器), `Backtrack` (回溯) 等组件。
- **能力注册制 (`Capability`)**: 智能体的功能通过 Capability 进行扩展，支持 **懒加载** (`_module`)。
- **三层优先级 Prompt 目录**: `AgentInstance` 能够根据能力的优先级（critical, important, optional）自动生成格式化的系统提示词，确保护航模型关注最核心的能力。
- **共享黑板 (`DiscoveryManager`)**: 负责维护 Gap (缺口) 和 Evidence (证据) 的语义状态，识别不同来源之间的冲突并协调验证。

### 生命周期管理 (Lifecycle)
- **回溯管理 (春秋蝉机制)**: `BacktrackManager` 专门负责智能体的“后悔药”机制。与 Cicada 压缩系统深度集成，支持在长时间对话中跨轮次精准回滚。
- **健康监控 (`AlertMonitor` / `Watchdog`)**: 在运行时监控智能体的状态，检测死循环、Token 过载或响应超时，并触发告警或自动干预。
- **子代理注册制 (`SubagentRegistry`)**: 支持多级智能体嵌套。当注册了子代理时，Builder 会自动注入 `Task` 工具，允许父代理派发子任务。

## 2. 优化 Trick (Optimization Tricks)

- **工具劫持与上下文注入**: 在 `AgentBuilder.build()` 时，Capability 会被包装。执行时自动注入 `discoveryManager`、`eventBus` 和 `logger`。
- **自动工具注入**: 只要配置了 `Cicada` 或 `Backtrack`，Builder 会自动注入 `Recall` (记忆检索) 和 `Backtrack` (状态回滚) 工具。
- **事件模式匹配**: `onEvent` 支持通配符匹配（如 `deepsearch.*`），简化了复杂事件流的监听逻辑。
- **配置懒加载**: 只有在真正调用工具时才 `import` 对应的处理模块，极大地提升了大型 Agent 的启动速度。

## 3. 对比 Claude Code (analysis-cc) 的优势与差距

- **优势**: SDK 的组合性极强。通过 `useCapability`, `useHook`, `useMcp` 等方法，可以像搭积木一样定制智能体。
- **优势**: **春秋蝉 (Backtrack)** 机制结合 **共享黑板 (Discovery)** 构成了比 Claude Code 更强大的闭环验证体系。
- **差距**: Claude Code 在 `src/config/` 中对环境变量和多层配置（项目/全局/企业）的处理更为严密。我们的 SDK 目前对持久化配置的分层覆盖逻辑尚显单薄。
- **改进点**: 引入 Claude Code 的 `Discovery` 自动纠偏逻辑，当 `DiscoveryManager` 检测到 `CONTRADICTED` 时，自动提升对应验证工具的优先级。
