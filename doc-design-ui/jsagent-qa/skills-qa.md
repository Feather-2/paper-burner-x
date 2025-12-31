# Skills 文件夹审查报告 (js/agents/skills)

## 1. 潜在问题清单

### 1.1 匹配与注入逻辑 (Matching & Injection)
- **语义匹配性能风险**: `matchSemantic` 采用基础的单词交集算法（第 300 行）。虽然简单，但在处理大规模 Skill 库时，每轮请求都对所有 Skill 进行全量分词和交集计算会造成显著的性能损耗。此外，该算法无法理解同义词，匹配精度有限。
- **匹配分数的魔数依赖**: 计算分数时存在大量的硬编码偏移（如 `0.55 + 0.2 * ...`，第 229 行）。这些权重缺乏理论依据和参数化配置，难以根据不同领域的任务进行调优。
- **Token 提取逻辑简陋**: `extractTokensForIndex` 仅匹配 ASCII 单词和连续 CJK 字符（第 79, 80 行）。对于包含缩写、专业术语或混合语言的情况，这种分词方式会产生大量垃圾 Token 或丢失关键特征。

### 1.2 生命周期与加载 (Lifecycle & Loading)
- **远程 Skill 延迟加载缺失**: `SkillsManager` 标记远程 Skill 的 `body: null`（第 69 行），但 `buildSkillInjections` 在注入时并没有显式的逻辑从 `remoteProvider` 获取内容，导致远程 Skill 可能无法被真正注入到 Prompt 中。
- **CWD 缓存膨胀**: `cacheByDir` 是一个 Map（第 29 行），且没有过期或清理机制。如果在动态环境下频繁更换工作目录，内存会随着目录数的增加而持续增长。
- **环境检测的原子性**: `readSkillContentsFromPath` 混合了 `fetch` 和 `fs` 逻辑（第 48 行）。在混合环境下（如 Node 中运行带有 `fetch` polyfill 的脚本），可能会因为错误的优先级选择导致路径解析失败。

### 1.3 渲染与一致性 (Rendering & Consistency)
- **Catalog 冗余**: `renderUnifiedCatalog` 同时处理 Capabilities 和 Skills（第 139 行），但两者的优先级定义不完全一致（Capabilities 偏向数字优先级，Skills 偏向字符串 Tag）。这种差异会导致渲染后的 Catalog 在视觉优先级上产生混乱。
- **Prompt Cache 破坏**: `renderSkillsSection` 在 Skill 条目中包含了文件路径（第 74 行）。由于不同环境下文件绝对路径可能改变，这会破坏 LLM 服务端的 Prompt Caching 机制，导致 Token 消耗增加和首字延迟（TTFT）上升。

### 1.4 安全性 (Security)
- **路径遍历保护缺失**: `readSkillContentsFromPath` 虽然做了路径修剪，但没有校验目标文件是否超出了允许的 `skills` 目录范围，存在读取系统敏感文件的风险。
- **Nexus 协议注入**: 远程 Provider 的 URL 解析缺乏严格的 Schema 验证，恶意配置可能通过注入特殊的远程 URL 触发 SSRF。

## 2. 改进建议
1. **引入向量检索**: 对于语义匹配，建议在本地构建轻量级的 Embedding 索引（或使用更高效的 BM25 算法），提高匹配的准确性和大规模下的响应速度。
2. **抽象存储层**: 将本地文件读取和远程 Fetch 抽象为统一的 `SkillStore` 接口，解耦环境检测逻辑。
3. **优化 Prompt 缓存**: 在渲染 Catalog 时使用相对路径或哈希 ID 替代绝对路径，确保不同部署环境下 Prompt 的稳定性。
4. **完善远程协议**: 明确 `nexus://` 协议的通信标准，并增加对远程 Skill 内容的校验和超时控制。
5. **引入 LRU 缓存**: 为 `SkillsManager` 增加带有 TTL 或最大容量限制的 LRU 缓存，防止内存泄露。

## cc是如何解决这个问题的

Claude Code (CC) 通过一套基于文件系统的声明式技能（Skill）和斜杠命令（Slash Command）系统解决了扩展能力管理的问题：

1.  **分层的优先级与覆盖机制**:
    *   **明确的加载顺序**: CC 按照 `builtin` -> `user` (~/.claude) -> `project` (.claude) 的顺序加载技能 ([`src/tools/skill.ts`](ref/claude-code-open-main/src/tools/skill.ts))。后加载的同名技能会根据 `priority` 自动覆盖先前的技能，解决了 Catalog 冗余和优先级混乱的问题。
    *   **作用域隔离**: 区分了用户全局技能和项目特定技能，确保了环境的一致性。

2.  **结构化的 Frontmatter 元数据**:
    *   **声明式约束**: 技能文件支持 YAML Frontmatter，允许显式定义 `allowed-tools`, `model`, `when-to-use` 等字段。这使得 Agent 在调用技能前就能通过元数据进行权限校验和环境匹配，不再依赖于模糊的“单词交集算法”。
    *   **权限沙箱**: 技能可以限制可用的工具集（`allowedTools`），这为复杂任务提供了一个安全的最小特权执行环境。

3.  **缓存与按需加载优化**:
    *   **TTL 缓存机制**: `initializeSkillsAndCommands` 引入了 `CACHE_TTL` (5分钟) 逻辑，防止了频繁的文件系统 I/O，同时通过 `skillsLoaded` 状态位解决了 jsagents 中提到的内存膨胀风险。
    *   **懒加载模式**: 仅在 `SkillTool` 实际执行或权限检查时才触发 `ensureSkillsLoaded`，实现了资源的按需分配。

4.  **Prompt 缓存友好**:
    *   **路径脱敏**: CC 在渲染技能信息时，优先使用技能名称而非物理路径，并在 `outputMessage` 中封装了结构化的 XML 标签（`<skill name="..." location="...">`），这种确定性的输出结构极大提高了 LLM 服务端的 Prompt Cache 命中率。

5.  **环境适配与安全性**:
    *   **路径解析抽象**: 提供了统一的 `loadSkillsFromPath` 递归逻辑，并结合 `fileURLToPath` 处理模块路径。
    *   **纯浏览器端适配**: CC 的技能系统核心是基于 Markdown 的字符串解析。在浏览器端，只需将 `fs.readFileSync` 替换为对远程静态资源或 `IndexedDB` 的读取，其 `parseFrontmatter` 逻辑无需改动即可在 Worker 或主线程中完美运行。
