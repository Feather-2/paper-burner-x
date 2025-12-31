# Analysis: Stages & Pipelines (阶段与流水线)

## 1. 架构 (Architecture)

### 模块化流水线 (`js/agents/stages/`)
我们将 Agent 的执行过程拆分为四个核心物理阶段，每个阶段都是一个独立的子工程，且大多继承自 `BaseStage` 或 `BaseAgentLoop`：

1.  **文本准备 (`textprep/`)**:
    - **职责**: 原始素材的清洗、分块（Chunking）、幻灯片规划（Slide Planning）和核心主张提取（Claims）。
    - **关键逻辑**: `TextPrepStage` 实现了从 `normalize` 到 `build-content-package` 的完整线性流。它通过 `alignClaimsToSlides` 实现 AI 驱动的证据对齐。
    - **输出**: 产生 `ContentPackage v0.1`。

2.  **深度研究 (`deepsearch/`)**:
    - **职责**: 自治式的复杂问题调研。基于 `DeepSearchAgentLoop`。
    - **架构**: 拥有独立的 `runtime`、`state` 管理和 `report` 生成模块。
    - **闭合回路**: 通过 `manage-todos` 工具实现任务的动态拆分与跟进。它不仅是简单的 ReAct 循环，还具备专门的 `WritingPhase` 处理器。

3.  **设计执行 (`design/`)**:
    - **职责**: 视觉呈现与 DSL 生成。基于 `DesignAgentLoop`。
    - **复杂组件**: 包含 `runPreparationPhase` (样式提取)、`runLayoutPhase` (线框图生成)、`runGeneratingPhase` (DSL 生成) 及 `runVisualPhase` (资产填充)。
    - **回溯支持**: 内置 `BacktrackError` 机制，配合 `DesignBlackboard` (共享黑板)，支持在设计失败时自动重启至特定阶段。

4.  **代码搜索 (`codesearch/`)**:
    - **职责**: 针对代码库的深度检索和符号关联。
    - **关键逻辑**: `codesearch-stage.js` 封装了基于符号的代码导航逻辑。

## 2. 优化 Trick (Optimization Tricks)

- **异步生成队列**: Design 阶段通过 `batchSize` 和 `batchConcurrency` 控制生成并发，平衡速度与速率限制（Rate Limit）。
- **共享黑板与版本管理**: `DesignBlackboard` 不仅同步元数据，还支持 `saveVersion`，为 UI 撤销重做和 Agent 自动回溯提供基础。
- **差异化重构**: 修复设计错误时，通过 `fix_slide` 工具只更新受影响的 DSL 节点。
- **证据引用自动关联**: 在 DeepSearch 报告生成过程中，通过 `citations.js` 将 Finding 自动映射回原始 Chunk 偏移量。
- **线框图先行 (Layout Phase)**: 在生成正式 DSL 前，先生成 Layout 线框图，降低 LLM 在视觉结构上的发散性。

## 3. 对比 Claude Code (analysis-cc) 的优势与差距

- **优势**: 我们的 Stage 划分更偏向 **“业务流水线”**（如专门的 PPT 设计、深度报告生成），而 Claude Code 的划分更偏向 **“系统功能”**（如 Git, LSP, MCP）。
- **优势**: **DeepSearch** 的独立闭环能力非常强，具备完善的 Todo 管理和 Gap 评估机制。
- **优势**: **Design 阶段的阶段性回溯能力** 远超 Claude Code 的通用回退，因为它感知具体的业务 Phase。
- **差距**: 我们的 `codesearch` 阶段目前对 Tree-sitter 的利用不如 Claude Code 在 `src/parser/` 中那么彻底。
- **改进点**: 将 `textprep` 中的 Claims 提取逻辑标准化，作为一种通用的“知识颗粒度化”工具供所有阶段使用。
