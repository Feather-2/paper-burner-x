# Analysis: Extensions & Assistance (扩展与辅助)

## 1. 架构 (Architecture)

### 技能系统 (`js/agents/skills/`)
- **SKILL.md 指令包**: Skills 是以 Markdown 定义的策略/知识包。它们不同于原子化的 Tools，而是用于引导模型如何使用 Tools 的高层指令。
- **三级加载路径**: 支持 `repo` (项目级) > `user` (用户级) > `system` (系统级) 的多层 Skill 加载。
- **环境自适应加载器 (`loader.js`)**: 在 Node 端自动扫描 `.paper-burner/skills`，在 Browser 端则通过读取 `manifest.json` 进行 fetch 加载。
- **动态注入管理器 (`SkillsManager`)**: 支持按目录（CWD）缓存 Skills，并根据用户输入动态匹配（显式提及、语义匹配、关键词匹配）并将指令注入上下文。

### 提示词管理 (`js/agents/prompts/`)
- **外部化 Markdown 模板**: 所有的系统提示词和任务指令都存储在 `.md` 文件中，通过 `prompt-loader.js` 统一加载，实现了提示词与逻辑代码的彻底分离。

### 测试与遥测 (`js/agents/testing/` & `js/agents/runtime/telemetry/`)
- **Mock 系统**: `MockProvider` 支持模拟各种 LLM 响应，用于在不消耗 Token 的情况下验证 Agent 的状态迁移。
- **执行回放**: `ReplayController` 允许重现历史执行轨迹。

## 2. 优化 Trick (Optimization Tricks)

- **Skills 目录指纹缓存**: `SkillsManager` 按 CWD 缓存加载结果。在 Browser 端，通过 `getCatalogPrompt` 仅返回元数据以保持 Prompt Cache 的稳定性。
- **远程 Skill 桥接**: 支持通过 `McpNexusProvider` 动态拉取远程共享技能，本地本地 Skill 优先覆盖。
- **提示词占位符渲染**: `prompt-loader` 支持运行时变量注入，增强了外部 Markdown 模板的灵活性。

## 3. 对比 Claude Code (analysis-cc) 的优势与差距

- **优势**: 我们的 **Skill vs Tool 分离** 架构非常先进。Skill 作为“策略包”存放在 Markdown 中，让非开发人员也能通过修改文档来调整 Agent 的行为逻辑。
- **优势**: **跨环境 Skill 加载**。原生支持在浏览器中远程拉取 Skill，这比 Claude Code 纯本地的扩展方式更适合 SaaS 场景。
- **差距**: Claude Code 的 CLI 交互（如自动补全、进度渲染）非常成熟。
- **改进点**: 引入类似 Claude Code 的 `Progressive Injection` 策略。不是一次性注入所有匹配的 Skill，而是根据对话轮次和相关性，分批次、有权重的注入 Skill 以节省上下文窗口。
