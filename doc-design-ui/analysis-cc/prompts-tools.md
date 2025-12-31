# Analysis: Prompts & Tools (提示词与工具)

## 1. 架构 (Architecture)

### Prompt 构建系统
- **`SystemPromptBuilder` (`prompt/builder.ts`)**: 采用模块化组装模式。系统提示词由多个模板（身份、风格、指南、Git、子代理等）组合。它包含：
  - **Token 估算**: 针对中英文、代码特征（如 `function`, `class`）及特殊符号进行启发式计算。
  - **截断策略**: 当超过 `maxTokens`（默认 180,000）时，优先保留核心部分（身份、工具指南等），并插入 `<system-reminder>` 告知模型。
  - **缓存机制**: 基于会话上下文生成 `cacheKey`。
- **附件系统 (`AttachmentManager` & `attachments.ts`)**: 动态生成并按优先级（Priority）排序注入附件：
  - `CLAUDE.md`: 优先级 10，支持项目级自定义规则。
  - `Critical System Reminder`: 优先级 1，最高优先级提醒。
  - `IDE Selection & Opened Files`: 提供当前编辑器的实时上下文。
  - `Diagnostics`: 注入 Linter/编译错误。
  - `Git Status`: 注入分支、暂存区、未追踪文件及领先/落后信息。
- **缓存机制 (`PromptCache`)**: 使用哈希值记录构建结果，避免在同一个会话中重复进行昂贵的提示词组装操作。

### 工具扩展体系
- **`ToolRegistry` (`tools/base.ts`)**: 统一的注册中心。所有工具都继承自基类。
- **复合工具设计**:
  - `MultiEditTool`: 支持一次性对多个文件进行编辑，减少模型往返。
  - `LSPTool`: 封装 `lsp/index.ts` 能力，提供符号定义、引用查找等。
  - `McpTool`: 实现 `ListMcpResources`, `ReadMcpResource`, `MCPSearch`。
  - `BashTool` & `BashOutputTool`: 提供异步终端执行能力，支持 `KillShell`。
  - `NotebookEditTool`: 专门用于编辑 Jupyter Notebook。
  - `TmuxTool`: 交互式会话管理。
  - `SkillTool` & `SlashCommandTool`: 扩展 Agent 技能和斜杠命令（`/help` 等）。

## 2. 优化 Trick (Optimization Tricks)

- **Token 估算与截断策略**:
  - `estimateTokens`: 在不调用模型接口的情况下，通过启发式算法（如区分中英文、识别代码特征）快速估算 Token。
  - **优雅截断**: 当提示词过长时，`truncateToLimit` 会优先保留核心身份和指南，而牺牲部分非核心附件内容，并插入 `<system-reminder>` 告知模型上下文已被部分截断。
- **智能 Token 节省**:
  - `TaskOutputTool`: 作为一个统一的输出收集器，支持对 Bash 和 Agent 输出的异步监听，避免在 Loop 中由于等待大型输出而阻塞。
- **差异化编辑 (`EditTool`)**: 推荐模型使用类似 `diff` 的方式提交修改，而不是全量覆盖，极大地节省了 Output Token。

## 3. 对我们 Agent (docs\agents) 的可取之处

- **模块化 Prompt 模板**: 我们的系统提示词目前可能比较臃肿。可以学习 Claude Code 将其拆分为 `identity.ts`, `coding_guidelines.ts` 等模块，并根据当前任务动态组合。
- **环境附件机制**: 自动检测项目环境（如是否为 React 项目，是否安装了某些依赖）并作为 `Attachment` 动态插入提示词，使 Agent 具备环境感知能力。
- **LSP 集成**: 引入类似的 `LSPTool`，让 Agent 能在处理大型工程时利用索引进行符号搜索，而不是盲目地使用 `grep`。
- **本地 Token 计数器**: 实现类似的启发式计数器，在发送请求前拦截过长的上下文，提醒用户或自动触发精简策略。
