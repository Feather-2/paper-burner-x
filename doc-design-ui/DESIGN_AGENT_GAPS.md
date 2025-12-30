# Agent 工业级架构全景报告：Paper Burner vs Claude Code (终极版)

本报告是对 `ref/claude-code-open-main` (Claude Code 复现版) 全量源码进行“分片解构”后的最高规格技术审计。我们不仅扫描了逻辑层，更深入到了协议、安全、算法及工程细节层。

---

## 1. 核心定位与研发哲学

| 维度 | Claude Code (参考项目) | Paper Burner (本项目) |
| :--- | :--- | :--- |
| **核心定位** | **代码专家 (Code Specialist)**：追求极致的代码感知与原子化重构。 | **业务编排专家 (Orchestrator)**：侧重复杂业务流水线与多阶段协作。 |
| **运行环境** | **本地优先**：强绑定宿主机 Shell 与 Node 运行时。 | **边缘/跨平台优先**：原生兼容浏览器、CF Workers。 |
| **核心优势** | **交互与工具链的深度整合**：如 IDE 影子联动。 | **长任务编排与状态弹性**：基于 Stages 的持久化架构。 |

---

## 2. 二十五项工业级核心机制全量挖掘

### 一、 上下文治理与成本管控
1.  **持久化输出管理 (`<persisted-output>`)**：大文本自动截断预览，配合旧结果定时清理算法。
2.  **亚洲语系 Token 估算优化**：针对 CJK 字符采用差异化权重 (2.0 chars/token)，提升命中率预测。
3.  **环境感知哈希缓存 (Salted Caching)**：Cache Key 引入 `workingDir`、`platform` 等运行时盐值。
4.  **会话生命周期管理 (TTL)**：30 天自动失效清理机制。

### 二、 执行安全性与原子化操作
5.  **事务编辑模型 (`MultiEdit`)**：`Backup -> Conflict Detect -> Validate -> Commit -> Rollback` 的 8 阶段事务。
6.  **代码指纹签名体系 (Code Signing)**：使用 **Ed25519** 签名修改，并实时监听外部篡改 (Invalidation Watcher)。
7.  **系统级沙箱隔离**：集成 Linux `bubblewrap` 建立物理级隔离。
8.  **实用主义工具封装**：深度包装 GitHub CLI (`gh`) 和 Tmux，而非重写 API。
9.  **插件文件沙箱**：通过 `context.fs` 限制插件只能在自有目录活动。

### 三、 智能理解与深度推理
10. **多语言符号提取 (Polyglot Queries)**：预置 10+ 语言的精细 Tree-sitter 查询模板。
11. **自适应思考预算 (Adaptive Thinking)**：根据任务难度动态分配 `extended_thinking` 额度。
12. **全功能 LSP 集成**：支持 **Call Hierarchy (调用链分析)**。
13. **分布式环境验证**：Teleport 前强制校验 Git Repo URL 和 Branch 的一致性。

### 四、 系统鲁棒性与自愈
14. **流式响应 JSON 容错 (`parseTolerantJSON`)**：自动修复 LLM 产生的破损 JSON（补全括号、引号）。
15. **流式渲染背压控制 (Backpressure)**：利用 microtask 队列平滑高频输出。
16. **自愈式健康检查评分**：`/doctor` 命令通过 20+ 指标打分并关联 `autoFix` 脚本。
17. **长任务心跳监测与自动熔断**：5s 级探测，30s 无响应自动断链。
18. **带 Jitter 的指数退避**：防止大规模并发请求导致的“惊群效应”。

### 五、 交互演进与生态
19. **IDE 影子同步 (IDE Shadowing)**：支持 Socket 反向驱动本地 IDE，包含实时 **Selection 同步**。
20. **Markdown-as-Skill 扩展系统**：文档即技能，支持层级覆盖策略 (Project > User > Builtin)。
21. **智能插件推荐系统 (`Recommender`)**：基于文件特征和关键词主动触发推荐。
22. **无头多任务管理 (Tmux Tasking)**：利用 Tmux 实现可并行、可恢复的长命令管理。
23. **WASM 作为降级方案 (WASM Fallbacks)**：原生与 WASM 无缝切换，确保跨环境行为一致。
24. **WASM 可视化渲染引擎**：集成 `resvg-wasm`，支持 Agent 动态生成架构图等富媒体反馈。
25. **会话传送门 (Session Teleporting)**：基于 WebSocket 的实时状态同步协议。

---

## 3. 针对本项目的“演进设计建议”

为了保持 Web/边缘侧的领先地位，我们应采纳以下方案：

1.  **Unified Worker 运行时**：抹平 `node:worker_threads` (Node) 与 `Web Worker` (Browser) 的差异。
2.  **VFS 对接 OPFS**：在浏览器环境下透明对接原生私有文件系统，提升持久化性能。
3.  **WebContainer 深度集成**：在浏览器 Tab 页内运行虚拟 Node 环境，实现闭环开发。
4.  **补全 `AGENTS.md`**：参考 `CLAUDE.md` 建立一套本项目的 Agent 开发元规则与架构规范。

---

## 4. 演进路线图 (Roadmap)

### 第一阶段：健壮性与鲁棒性 - Q1
- [ ] 集成 `parseTolerantJSON` 容错逻辑。
- [ ] 实现工具输出自动截断与持久化标签。
- [ ] 增加 `health-check` 的 `autoFix` 接口。
- [ ] 补全 `AGENTS.md` 架构规范。

### 第二阶段：专业度提升 - Q2
- [ ] 引入 `tree-sitter-wasm` 与声明式 Query 模板。
- [ ] 重构 `EditTool` 为原子事务模式，增加 **Code Signing** 签名验证。
- [ ] 实现基于 Markdown 的层级技能系统。

### 第三阶段：全连接与可视化 - Q3
- [ ] 开发 **IDE Connector**，实现影子同步。
- [ ] 集成 `resvg-wasm` 开启 Agent 可视化反馈能力。
- [ ] 探索 WebContainer 与 OPFS 的融合方案。
