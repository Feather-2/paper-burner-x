# Analysis: Context & Git (上下文与 Git)

## 1. 架构 (Architecture)

### 智能上下文管理 (`src/context/`)
- **`Summarizer` (`context/summarizer.ts`)**: 这是一个核心组件，负责在上下文预算（Token Budget）即将耗尽时，利用 LLM 对之前的对话进行“自摘要”。
- **滑动窗口策略**: 系统不仅记录简单的消息列表，还通过 `ConversationTurn` 结构化每一轮对话，包含 Token 使用情况、工具调用结果等。
- **倒序预算收集**: `collectWithinBudget` 采用从最新消息向后回溯的策略，确保最重要的（最近的）上下文被保留。

### Git 深度集成 (`src/git/`)
- **结构化分析 (`git/analysis.ts`)**: 封装了复杂的 Git 操作。它不只是简单的命令封装，还提供了以下接口：
  - `getDiffStats`: 返回 `filesChanged`, `insertions`, `deletions` 和修改的文件列表。
  - `getRecentCommits`: 使用 `--format` 获取结构化提交历史（Hash, Author, Date, Message）。
  - `getFileHistory`: 追踪特定文件的修改记录。
  - `getDiffFromDefaultBranch`: 智能识别默认分支并生成三点 Diff (`origin/main...HEAD`)。
- **安全检查 (`git/safety.ts`)**: 在执行破坏性操作（如 reset）前进行状态检查。
- **环境感知**: 系统会自动识别当前是否在 Git 仓库中，并根据分叉点自动确定 `Default Branch`。

## 2. 优化 Trick (Optimization Tricks)

- **摘要 Token 增量计算**: 在 `collectWithinBudget` 中，系统会通过计算相邻消息的 Token 差异（Delta）来动态评估剩余空间，这比简单的累加更精确。
- **短标题生成**: 摘要系统被要求生成 "5-10 word title"，这种极简设计既能让模型理解过去发生了什么，又极大地节省了宝贵的上下文空间。
- **Git 摘要注入**: 将 `git diff --shortstat` 的结果注入提示词，让模型在不读取全部代码变更的情况下，先对改动规模有一个全局认知。
- **Merge-Base 比较**: 智能使用 `git diff origin/main...HEAD`，只显示当前特性分支的改动，屏蔽上游合并带来的噪音。

## 3. 对我们 Agent (docs\agents) 的可取之处

- **对话自摘要机制**: 当我们的 Agent 处理长任务时，目前的上下文管理可能较弱。引入类似的 `Summarizer`，在达到阈值时自动生成“任务简报”并清空旧历史，可以显著提升长对话的稳定性。
- **结构化 Git 工具**: 将现有的 Git 脚本封装为类似的 `GitAnalysis` 类，提供返回 JSON 对象的接口，方便 Agent 直接解析变更统计数据。
- **任务感知摘要**: 摘要不仅是内容的压缩，还应包含“当前状态 (current status)”，这对于 Agent 维持任务目标一致性至关重要。
- **分级 Context 策略**: 
  1. 最近 3 轮：原始完整内容。
  2. 3 轮以前：结构化摘要（包含文件名、变更行数）。
  3. 任务开始点：初始需求及全局架构附件。
