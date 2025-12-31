# Analysis: MCP & Parser (协议与解析)

## 1. 架构 (Architecture)

### MCP (Model Context Protocol) 体系 (`src/mcp/`)
- **MCP 适配器 (`McpAdapter` in `mcp/adapter.ts`)**: 核心转换层，负责：
  - **工具转换**: 将 MCP 工具（JSON Schema）转换为 Claude Code 工具定义，使用 `mcp__server__tool` 命名空间。
  - **资源适配**: 将 MCP 资源映射为 `ContextProvider`，支持按需读取。
  - **提示适配**: 将 MCP 提示（Prompts）转换为系统提示词增强。
  - **同步机制**: 支持全量或单服务器同步（Tools, Resources, Prompts）。
- **工具集成**: 通过 `callMcpTool` 实现代理调用，支持结构化输出（文本、图像等）。

### Tree-sitter 解析器 (`src/parser/`)
- **多模式解析 (`CodeParser`)**:
  - **Tree-sitter WASM**: 优先使用，支持 20+ 语言的精确 AST 分析。
  - **Regex 回退**: 在 WASM 不可用时使用正则作为保底方案。
- **增强功能**:
  - **增量解析 (`ParseCache`)**: 缓存 AST 树，仅对变更部分进行更新，大幅提升大文件处理性能。
  - **Query 驱动提取**: 使用 S-expressions 进行符号提取，关联 JSDoc/Docstring 及其函数签名。
  - **引用查找 (`ReferenceFinder`)**: 结合 Tree-sitter 作用域进行标识符引用查找。
  - **语法错误检测**: 查找 AST 中的 `ERROR` 或 `MISSING` 节点，提供实时反馈。
  - **折叠区域识别**: 基于 AST 节点（如 `class_body`, `function_definition`）识别可折叠块。

## 2. 优化 Trick (Optimization Tricks)

- **缓存 TTL 机制**: MCP 资源缓存带有 TTL（默认 60s），在保证数据新鲜度的同时降低了重复请求带来的延迟。
- **匿名符号智能命名**: 遇到匿名函数或闭包时，`generateAnonymousName` 会根据位置自动生成可识别的 ID（如 `<anonymous function at line 121>`），防止 LLM 在引用时产生歧义。
- **特征提取 (Signatures)**: 提取器不只是返回代码块，还专门格式化出 `signature`（如 `class A extends B`），让 LLM 能在极短的预览中快速建立代码心智模型。
- **预过滤机制**: 在 `preloadCommonResources` 中，系统会自动过滤掉超过 100KB 的巨型资源，优先保证轻量级核心信息的同步。

## 3. 对我们 Agent (docs\agents) 的可取之处

- **Query 驱动的检索**: 我们可以引入 Tree-sitter，利用 `.scm` 查询文件来精确搜索特定的“未编写测试的函数”或“不符合规范的命名”，比正则更可靠。
- **文档化符号列表**: 目前我们的文件列表只有路径。模仿此解析器，我们可以为每个文件生成一个 `symbols.json`（包含函数名和 JSDoc 摘要），作为 Agent 探索代码库的索引。
- **MCP 的广泛集成**: 通过 MCP 接入类似 Google Search, GitHub API, Jira 等外部能力，而不是为每个 API 单独编写工具类。
- **JSDoc 自动关联**: 在代码修改建议中，要求 Agent 同时更新关联的 JSDoc，利用 `SymbolExtractor` 的逻辑来验证注释与实现的一致性。
