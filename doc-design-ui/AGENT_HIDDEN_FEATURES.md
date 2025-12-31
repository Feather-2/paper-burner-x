# Agent 隐秘特性与极客工程实践深度解析

本报告是对 `claude-code` 架构中那些文档未详述、但对系统鲁棒性和智能化起到决定性作用的“黑科技”特性的深度挖掘。

---

## 1. 行为拦截与实时转换引擎 (Action Transform Engine)
**代码参考**：`src/rules/index.ts`

*   **机制描述**：
    `claude-code` 实现了一套基于正则表达式的实时 lint 引擎。它不仅能通过 `CLAUDE.md` 定义“禁止做什么”，还支持 `transform` 动作。
*   **具体细节**：
    当 Agent 生成一段包含 `console.log` 的代码时，若规则定义了 `transform: "logger.info"`, 引擎会在文本输出给用户/写入文件前，利用正则自动完成替换。
*   **本项目的参考点**：
    我们的 `EditTool` 往往是盲目写入。引入这种“输出侧规则引擎”，可以强制 Agent 遵守项目特有的编码规范，甚至自动修正 LLM 偶发的格式错误。

## 2. 环境信任链：实时代码指纹 (Code Fingerprinting)
**代码参考**：`src/codesign/index.ts`

*   **机制描述**：
    使用 **Ed25519** 算法对 Agent 修改的每一个文件进行哈希签名，并存储在 `.claude/signing/` 下。
*   **Watcher 失效模式**：
    系统后台运行着文件监听器（`fs.watch`）。一旦用户在外部手动修改了已被签名的文件，指纹立即判定为无效。
*   **价值**：
    这解决了 Agent 最怕的“幻觉根源”——即环境状态在不知情的情况下发生了改变。Agent 在下一步操作前会校验指纹，若失效则提示用户“环境已失真，请重新同步”。

## 3. 分层长期偏好记忆 (Layered Long-term Memory)
**代码参考**：`src/memory/index.ts`

*   **机制描述**：
    记忆分为 `Global` (跨项目) 和 `Project` (项目独有) 两个 KV 存储层。
*   **主动摘要注入 (Active Summary Injection)**：
    `MemoryManager` 会自动提取最近的 20 条记忆条目，并以结构化的 `## User Memory` 块形式，在每一轮对话中动态注入到 System Prompt 的头部。
*   **本项目的参考点**：
    我们的 `discoveries` 目前主要用于当前会话。引入这种层级化的、可自动汇总的记忆系统，能让 Agent 真正实现“越用越懂你”。

## 4. 容错性 JSON 状态机 (Tolerant JSON Parser)
**代码参考**：`src/streaming/message-stream.ts`

*   **机制描述**：
    `parseTolerantJSON` 并不是简单的 `JSON.parse`。它是一个针对 LLM 流式输出定制的状态机，能够：
    1.  自动闭合未完成的引号 `"`。
    2.  根据层级深度补全缺失的方括号 `]` 和花括号 `}`。
    3.  移除合规 JSON 严禁的尾部逗号。
*   **价值**：
    这极大降低了因网络波动或 LLM 吐字中断导致的“工具调用崩溃”概率。

## 5. 跨环境 WASM 降级策略 (WASM Fallback Strategy)
**代码参考**：`src/parser/language-loader.ts`

*   **机制描述**：
    为了兼顾 Node.js 的高性能和浏览器的兼容性，它实现了一套“双轨制”加载器。优先尝试加载原生 C++ 绑定的模块，若失败（如在浏览器环境或无编译工具环境）则无感切换到 WASM 编译版。
*   **本项目的参考点**：
    这是我们实现“纯浏览器可用” Agent 的核心技术范式。

## 6. 级联配置发现 (Cascading Discovery)
**代码参考**：`src/rules/index.ts` -> `findClaudeMd`

*   **机制描述**：
    仿照 `.gitignore` 的设计逻辑，Agent 会从当前操作目录递归向上回溯至家目录，寻找所有的 `.claude/` 目录和 `CLAUDE.md` 文件并进行深层合并。
*   **价值**：
    支持在根目录定义全局规则，在子项目定义局部规则，极大提升了多仓协作时的配置灵活性。

---

## 7. 改进路线图补全 (Roadmap Supplement)

### 新增目标 - Q2
- [ ] 开发 `RegexRuleEngine`：支持输出内容的正则校验与自动转换。
- [ ] 实现 `MemoryManager 2.0`：支持 Global/Project 分层记忆与自动摘要注入。

### 新增目标 - Q3
- [ ] 引入 `Ed25519` 代码指纹体系，建立环境完整性实时监控。
- [ ] 完善 `parseTolerantJSON`：实现基于流的 JSON 实时修复。
