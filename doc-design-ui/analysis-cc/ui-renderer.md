# Analysis: UI & Renderer (交互与渲染)

## 1. 架构 (Architecture)

### 终端 UI 系统 (`src/ui/`)
- **React-like 组件化架构**: 虽然是 CLI 工具，但 Claude Code 内部使用了类似 React 的组件模式（`App.tsx`, `components/`），通过 `ink` 库（虽然代码中是 TSX）将组件渲染到终端。
- **自动补全引擎 (`ui/autocomplete/`)**: 这是一个分层补全系统，支持三种优先级：
  1. 命令 (`/command`)
  2. 提及 (`@mention`)
  3. 文件路径 (`path/to/file`)
- **增强渲染器 (`ui/markdown-renderer.ts`)**: 一个高度定制的 Markdown 渲染系统。它不只是简单的将文本转 ANSI，而是将 Markdown 解析为结构化块 (`MarkdownBlock`)，然后针对不同类型的块进行定制化美化渲染。
- **多媒体渲染支撑 (`renderer/index.ts`)**: 封装了高性能图像处理能力，包括使用 `resvg-wasm` 进行 SVG 渲染、图像类型二进制头检测、尺寸提取以及 `SvgBuilder` 基础图形生成。

### 差异化视图 (`components/DiffView.tsx`)
- 系统专门为代码差异提供了可视化组件，支持 side-by-side 或 unified diff 的终端呈现。

## 2. 优化 Trick (Optimization Tricks)

- **终端自适应布局**: 渲染器在处理代码块和表格时，会通过 `stripAnsiColors` 计算真实字符宽度，并根据终端宽度动态计算边框大小，防止错位。
- **内联样式反转渲染**: 代码片段使用 `chalk.yellow.inverse`（反显），使其在复杂文本中极具辨识度。
- **补全位置感应**: `applyCompletion` 会智能计算光标位置，确保补全插入后光标自动跳转到正确位置。
- **流式增量补全**: 补全查询是基于当前光标位置前的“最后一个片段”动态计算的，这种分段匹配机制比全文本匹配效率更高。

## 3. 对我们 Agent (docs\agents) 的可取之处

- **结构化 Markdown 处理**: 目前我们可能只是简单的打印 LLM 的输出。模仿其 `MarkdownBlock` 架构，我们可以将 Agent 的思考、工具调用结果、最终回答以不同的样式分块渲染，提升视觉层次。
- **智能自动补全**: 在输入需求时，为用户提供 `@file` 或 `/cmd` 的补全，能显著提升用户输入复杂路径的效率。
- **终端表格美化**: 目前我们的 agent 在打印检索结果时可能是原始文本。引入其 `renderTable` 逻辑，可以让数据展示更专业。
- **交互式确认组件**: 模仿其 `PermissionPrompt` 组件，将工具确认过程从简单的 `y/n` 提升到带有上下文背景说明的精美对话框。
