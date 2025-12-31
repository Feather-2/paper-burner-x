# Analysis: Sub-Agents & Collaborative Logic (子代理与协作逻辑)

## 1. 架构 (Architecture)

### 任务隔离与继承 (`js/agents/stages/*/subagents.js`)
我们的架构支持在大型阶段中孵化专用的“子代理”（Sub-Agents）。

1.  **DeepSearch 子代理**:
    - **`researcher`**: 侧重于专项文档研究，快速提取关键信息，限制在 10 轮迭代以内。
    - **`analyzer`**: 侧重于深度分析，适合处理逻辑复杂的长尾问题，支持最多 15 轮迭代。
    - **作用域隔离 (`TaskScopedSharedContext`)**: 使用 ES6 Proxy 拦截 `sharedContext`。子代理在访问“共享黑板”时，通过 `targetTaskId` 进行过滤，只能看到与其任务相关的信号和数据，实现了完美的逻辑隔离。

2.  **Design 阶段的专业协作**:
    - **`SlideSubAgent`**: 专注于单页幻灯片的排版和 DSL 生成。它能自动读取关联文件（`linkedFiles`）并整合补充 Markdown。
    - **`VisualSubAgent`**: 专门负责图片、图标和视觉资产的处理。
    - **状态机同步**: `SlideSubAgent` 内置了 `SlideStatus` 状态机，从 `PENDING` 到 `VISUAL_PENDING` 再到 `COMPLETED`，与父级 `DesignAgentLoop` 保持步调一致。

## 2. 优化 Trick (Optimization Tricks)

- **动态注入父级 API**: 子代理在创建时会继承父阶段的 `stageApi` 和 `modelRouter`。这保证了模型调用策略（如 `modelTier`）在整个任务链中的一致性。
- **循环依赖处理**: 采用 `async function getDeepSearchAgentLoop()` 延迟加载模式解决子代理与主循环类之间的循环导入问题。
- **关联资产自动描述**: `SlideSubAgent` 通过 `describeAsset` 自动为 LLM 准备资产的语义描述，提高生成准确度。
- **Proxy 拦截扩展**: 通过 Proxy 劫持 `buildBlackboardPrompt`，自动为子代理注入任务特定的上下文信息。

## 3. 对比 Claude Code (analysis-cc) 的优势与差距

- **优势**: 我们的 **子代理作用域隔离**（基于 Proxy 的 `sharedContext` 过滤）比 Claude Code 更精细，能有效防止大规模任务中的信息噪声。
- **优势**: **领域化智能体划分**（如 SlideSubAgent）。我们的子代理深度感知业务状态（如幻灯片排版状态），具备更强的垂直领域处理能力。
- **差距**: Claude Code 的子代理系统在提示词层面（`SUBAGENT_SYSTEM`）定义了更清晰的“协作契约”。
- **改进点**: 引入“协同回溯”机制。当 `SlideSubAgent` 发现布局失败时，可以向上级发送信号，触发 `DesignAgentLoop` 在 `Preparation` 阶段重新提取样式。
