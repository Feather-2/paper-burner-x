# js/agents 架构概览与边界评审（中文）

## 目的与范围

本文用于架构评审场景，聚焦 `js/agents` 的模块边界与设计决策，包含：
- 架构总览与层级边界
- 关键子模块职责与边界说明（基于全部 `CLAUDE.md`）
- 可改进点与评审问题清单

范围：仅覆盖 `js/agents` 子系统。

## 方法与资料来源

来源为 `js/agents` 目录下全部 `CLAUDE.md` 文件（89 个）以及 `js/agents/ARCHITECTURE-ISSUES.md`。

## 架构总览

```text
应用/产品层
  |
  v
SDK / Stages（面向业务）
  |
  v
Runtime（AgentLoop/Tools/Hooks/Middleware/Memory/Compression/Telemetry）
  |
  v
Core（Kernel + Event/State/Service/Message Bus + Plugins/Presets）
  |
  +--> Subsystems: Ingest / Retrieval / LLM / MCP / VFS / Skills / Storage / Shared
  |
  +--> Prompts / Plugins / Eval / Testing / CLI（支撑与配套）
```

设计要点：微内核 + 插件 + 事件驱动；跨平台（Browser/Node/Deno/Bun）；JS + JSDoc 零构建。

## 模块边界总图

- **Core（内核层）**：仅负责内核生命周期、总线与插件；不包含业务阶段与执行细节。
- **Runtime（执行层）**：负责 agent loop、工具执行、记忆与压缩等运行保障；不包含具体业务阶段策略。
- **Stages（业务层）**：DeepSearch/Design/CodeSearch/TextPrep 负责业务流程与状态；不侵入 core/runtime。
- **Subsystems（能力层）**：LLM/MCP/VFS/Ingest/Retrieval/Skills/Storage/Shared 提供通用能力，被 runtime/stages 组合使用。
- **Prompts/Plugins（配置扩展层）**：提示词与插件为可替换扩展点。
- **Eval/Testing/CLI（支持层）**：评估、测试与开发工具，不进入生产执行路径。

## 分层与子模块深挖（按 CLAUDE.md）

### 顶层入口（js/agents/CLAUDE.md）

- **定位**：js/agents 总入口与分层索引，明确微内核 + 三/四总线 + 插件化的架构方向，强调 JS + JSDoc 的零构建跨端运行。
- **边界**：仅聚合与指引，不承载业务逻辑或运行时实现细节。
- **关键导向**：Core/Runtime/Stages/SDK/Subsystems（ingest/llm/mcp/vfs/skills/retrieval/storage/shared）作为稳定的层级边界。

### Core 微内核（js/agents/core/CLAUDE.md）

- **职责**：Kernel 生命周期、Event/State/Service/Message Bus、插件系统、预设（presets）、安全插件加载、兼容层。
- **边界**：不包含业务流程（stages）与运行时执行细节（tool 执行、agent loop）。
- **设计决策**：核心保持轻量；能力通过插件与预设组合扩展。

#### CRDT 共识层（js/agents/core/crdt/CLAUDE.md）

- **职责**：面向 Agent 状态的 operation-based CRDT（LWWRegister/LWWMap/ORSet/GCounter/PNCounter）与同步管理。
- **边界**：仅处理结构化状态协作，不承担富文本协作（未来可引入 Yjs 作为可选插件）。
- **集成点**：通过 EventBus/StateBus/MessageBus 与 VFS 实现同步与持久化。
- **重要约束**：同步以 CRDTDocument 的 op 为单位；业务层写入后需主动广播 op。

#### 沙箱与系统隔离（js/agents/core/sandbox/CLAUDE.md）

- **职责**：双层沙箱体系——WASM 沙箱（QuickJS）用于 Skill 执行，System 沙箱用于 Shell 进程隔离。
- **边界**：不负责工具逻辑，仅提供安全执行环境与资源限制。
- **策略**：WASM 不可用时可降级为受限 JS；System 后端按隔离强度自动选择。

##### 系统级隔离（js/agents/core/sandbox/system/CLAUDE.md）

- **职责**：跨平台系统隔离执行器，统一 Bubblewrap / Seatbelt / Docker / Permission-only。
- **边界**：仅做安全执行与权限审批，不处理业务命令语义。
- **关键约束**：路径规范化防逃逸，环境变量注入受控，执行结果统一结构化返回。

### Runtime 运行时（js/agents/runtime/CLAUDE.md）

- **职责**：AgentLoop/Orchestrator/ToolRegistry 为核心的运行时执行框架，包含工具执行、压缩、遥测、记忆与跨环境协调。
- **边界**：执行层与基础能力层，不承载业务阶段逻辑。

#### Runtime Core（js/agents/runtime/core/CLAUDE.md）

- **职责**：BaseAgentLoop、状态机、MessageManager、ToolRegistry 以及 Worker/VFS 代理等核心组件。
- **边界**：执行基础设施，不包含业务流程。

#### Tools（js/agents/runtime/tools/CLAUDE.md）

- **职责**：工具执行器（ToolExecutor）与内置工具（Task/Recall/Backtrack/DMail），支持 Worker 隔离执行与参数校验。
- **边界**：只负责工具执行与生命周期，不定义业务流程；工具能力由注册表与平台适配提供。
- **关键机制**：工具配额与 schema 校验；可在 Worker/浏览器/Node 侧隔离执行。

##### Tools 平台适配（js/agents/runtime/tools/platform/CLAUDE.md）

- **职责**：为 glob/grep/read/write/list/bash 提供跨平台实现与能力探测。
- **边界**：不引入业务逻辑；Browser 端不提供 bash。
- **安全约束**：Node 端路径限制在 basePath 内，命令超时与结果限制；Browser 端完全基于 VFS。

#### Hooks（js/agents/runtime/hooks/CLAUDE.md）

- **职责**：Pre/Post Agent、LLM、Tool 调用钩子；HookRegistry 注册与执行；支持 EventBus 扩展与 VFS 热加载配置。
- **边界**：提供拦截与审计入口，不承担业务处理。
- **集成方式**：AgentLoop 内置 PreAgent/PostAgent；支持命令分类与权限控制。

#### Middleware（js/agents/runtime/middleware/CLAUDE.md）

- **职责**：基于 Koa 洋葱模型的中间件链，用于超时/重试/日志/遥测/快照等横切关注点。
- **边界**：不负责事件分发（与 Hooks 区分），仅围绕执行流。
- **设计说明**：Stage 常量定义在工具/模型/Agent 生命周期中的位置。

#### Compression（js/agents/runtime/compression/CLAUDE.md）

- **职责**：上下文压缩与健康监控，包含 Watchdog、CicadaCompressor、ProactiveCompressor 与压缩协调器。
- **边界**：只处理消息与摘要/归档策略，不承担业务规划与工具逻辑。
- **关键策略**：远模糊近精确、异步预生成摘要、L3 归档、KV cache 友好设计。

#### Telemetry（js/agents/runtime/telemetry/CLAUDE.md）

- **职责**：Token 统计、分布式追踪、运行回放与 RunStore 遥测接入。
- **边界**：观测与回放，不改变业务执行路径。
- **集成点**：EventBus 遥测订阅、RunStore 事件与时间线聚合。

#### Memory（js/agents/runtime/memory/CLAUDE.md）

- **职责**：MemoryStore/StateEngine/RetrievalEngine/L3Storage 组成的分层记忆与检索体系。
- **边界**：存储与检索状态，不负责具体阶段策略；支持去重、LRU 淘汰与检索预热。
- **设计点**：UnifiedMemoryStore 以 StateEngine 为单一事实源（SSOT）。

#### Context（js/agents/runtime/context/CLAUDE.md）

- **职责**：UnifiedAgentContext 统一 DeepSearchState/MemoryStore/SharedContext 的读写与 checkpoint。
- **边界**：聚合上下文与预算管理，不实现业务阶段逻辑。
- **关键机制**：Snapshotable 协议、子 Agent 预算分配、跨阶段信号/决策记录。

#### DI（js/agents/runtime/di/CLAUDE.md）

- **职责**：IoC 容器与服务生命周期管理，提供默认/测试容器构造。
- **边界**：只做依赖解析与注册，不实现业务逻辑。

#### Parallel（js/agents/runtime/parallel/CLAUDE.md）

- **职责**：DAG 任务图与分层拓扑排序，支持并行调度与依赖管理。
- **边界**：仅提供任务图抽象，不负责具体执行逻辑。

#### Plan（js/agents/runtime/plan/CLAUDE.md）

- **职责**：计划模型、生命周期与结构化计划输出（含 Markdown 渲染）。
- **边界**：计划管理与持久化，不涉及任务执行。

#### Analysis（js/agents/runtime/analysis/CLAUDE.md）

- **职责**：行为指纹、上下文蒸馏与语义收敛检测，用于发现循环/卡住/收敛等异常。
- **边界**：仅提供诊断与建议，不负责控制或中断主流程。

#### Safety（js/agents/runtime/safety/CLAUDE.md）

- **职责**：命令风险分类与工具权限管理（readonly/standard/elevated/custom）。
- **边界**：策略评估与拦截入口，不执行命令。
- **关键点**：命令解析 + 规则优先级（黑名单优先）。

#### Policy（js/agents/runtime/policy/CLAUDE.md）

- **职责**：工具/资源访问的策略匹配与审批决策，支持事件驱动审批与规则存储。
- **边界**：仅做授权与决策，不执行工具。

#### Routing（js/agents/runtime/routing/CLAUDE.md）

- **职责**：基于延迟与成功率的性能感知路由（FAST/POWER/FALLBACK）。
- **边界**：路由决策层，不实现具体模型调用。

#### Resilience（js/agents/runtime/resilience/CLAUDE.md）

- **职责**：基于健康指标的运行级别降级矩阵（normal/degraded/critical/offline）。
- **边界**：提供建议与开关，不直接改写业务逻辑。

#### Errors（js/agents/runtime/errors/CLAUDE.md）

- **职责**：静默错误采样、分类与导出，便于排障与监控。
- **边界**：不改变流程，仅记录。

#### Events（js/agents/runtime/events/CLAUDE.md）

- **职责**：统一运行时事件类型与兼容导出，覆盖 runtime/stages/ingest/design 等事件域。
- **边界**：事件命名与匹配工具，不承载业务逻辑。

#### Exec（js/agents/runtime/exec/CLAUDE.md）

- **职责**：Node 子进程执行封装（超时/输出限制/流式回调），浏览器为 stub。
- **边界**：执行层，不负责命令安全策略（由安全/权限层决定）。

#### Transports（js/agents/runtime/transports/CLAUDE.md）

- **职责**：与外部二进制工具的进程通信（JSONL/JSON-RPC），并封装为 Skill/Tool。
- **边界**：通信层，不定义上层业务协议。

#### Coordination（js/agents/runtime/coordination/CLAUDE.md）

- **职责**：跨 Tab/跨进程的会话访问与驱逐同步，维护缓存/LRU 一致性。
- **边界**：只同步元事件，不同步业务数据。

#### Checkpoints（js/agents/runtime/checkpoints/CLAUDE.md）

- **职责**：Agent 运行检查点保存/恢复（VFS 持久化 + index.json 索引）。
- **边界**：只处理快照存储与恢复策略，不参与业务状态决策。

#### Manifest（js/agents/runtime/manifest/CLAUDE.md）

- **职责**：Tool/Skill/Stage/Middleware 的声明式清单、权限推断与注册。
- **边界**：元数据与权限推断层，不参与执行。

#### Deps（js/agents/runtime/deps/CLAUDE.md）

- **职责**：Pyodide 运行与 Python Skill 依赖管理（DependencyManager）。
- **边界**：仅覆盖 Python Skill 生态，不介入 JS 工具执行。

#### Constants（js/agents/runtime/constants/CLAUDE.md）

- **职责**：统一运行时默认超时/限制/阈值，提供轻量覆盖访问器。
- **边界**：仅配置口径，不包含逻辑。

#### API（js/agents/runtime/api/CLAUDE.md）

- **职责**：StageApiFactory 统一构建 Stage API，并注入默认运行时保障（重试、熔断、配额、遥测）。
- **边界**：API 组装层，不实现具体 stage 逻辑。
- **关键点**：Browser-first 适配、EventBus 回压、运行时服务透传。

#### Side Effects（js/agents/runtime/side-effects/CLAUDE.md）

- **职责**：可回滚副作用日志（WAL），用于 VFS 写入回滚与 Backtrack。
- **边界**：记录与回放，不决定何时回滚。

#### Runtime Kernel（js/agents/runtime/kernel/CLAUDE.md）

- **职责**：旧版 MicroKernel 兼容层（EventBus + 服务注册 + 调度转发）。
- **边界**：仅兼容历史 API；主线核心为 `js/agents/core`。

### Stages（js/agents/stages/CLAUDE.md）

- **职责**：预置业务工作流阶段（DeepSearch/Design/CodeSearch/TextPrep）。
- **边界**：阶段封装，不侵入 Core/Runtime 实现。

#### CodeSearch（js/agents/stages/codesearch/CLAUDE.md）

- **职责**：代码库索引、符号检索与三阶段搜索流程（规划/执行/总结）。
- **边界**：阶段封装，依赖 runtime/工具与提示词，不落入核心运行时。

##### CodeSearch 索引（js/agents/stages/codesearch/indexing/CLAUDE.md）

- **职责**：符号索引与索引存储（SymbolIndexer / IndexStore）。
- **边界**：索引构建与查询，不负责检索策略编排。

##### CodeSearch 阶段（js/agents/stages/codesearch/phases/CLAUDE.md）

- **职责**：函数式三阶段流程实现（planning/execution/summarizing）。
- **边界**：阶段执行逻辑，不包含底层工具实现。

#### DeepSearch（js/agents/stages/deepsearch/CLAUDE.md）

- **职责**：多轮文档分析、任务规划与报告生成的完整阶段。
- **边界**：阶段封装，不下沉到 runtime/core 实现。
- **核心对象**：DeepSearchState（L0/L1/L2/L3 分层）、能力加载、tools/phases/report/runtime 子模块。

##### DeepSearch 模型（js/agents/stages/deepsearch/model/CLAUDE.md）

- **职责**：模型调用适配、用量归一化与成本估算，预算预警/超限事件。
- **边界**：成本/预算层，不处理业务决策。

##### DeepSearch 阶段（js/agents/stages/deepsearch/phases/CLAUDE.md）

- **职责**：规划→执行→写作的三阶段流程，负责 prompt 组装、工具执行与收敛追踪。
- **边界**：阶段编排逻辑，不实现工具细节。

##### DeepSearch 报告（js/agents/stages/deepsearch/report/CLAUDE.md）

- **职责**：报告结构、引用处理、质量/长度校验与后处理。
- **边界**：报告生成策略，不管理上游检索与状态。

##### DeepSearch 运行时（js/agents/stages/deepsearch/runtime/CLAUDE.md）

- **职责**：阶段级运行时保障（checkpoint/backtrack/sharedContext/写作补全/容错）。
- **边界**：仅服务 DeepSearch 阶段，不作为全局 runtime 能力。

##### DeepSearch 状态（js/agents/stages/deepsearch/state/CLAUDE.md）

- **职责**：DeepSearchState 的读写、序列化、checkpoint 与 MemoryStore 同步。
- **边界**：状态管理层，不处理业务策略。

##### DeepSearch 工具（js/agents/stages/deepsearch/tools/CLAUDE.md）

- **职责**：DeepSearch 工具注册/目录提示/执行与配额控制。
- **边界**：工具层仅提供原子执行与状态回写。

###### Cross-Verify 工具（js/agents/stages/deepsearch/tools/cross-verify/CLAUDE.md）

- **职责**：对冲突事实发起子任务核验并回写状态/黑板。
- **边界**：核验流程工具，不负责上游证据采集策略。

###### Record-Finding 工具（js/agents/stages/deepsearch/tools/record-finding/CLAUDE.md）

- **职责**：记录 claims/gaps/conflicts，并写入 SharedContext/索引。
- **边界**：记录与去重，不负责生成发现内容。

###### Search-Docs 工具（js/agents/stages/deepsearch/tools/search-docs/CLAUDE.md）

- **职责**：文档检索（关键词/语义）与 MMR 重排，支持外部检索器降级。
- **边界**：检索执行，不负责报告生成。

###### Task 工具（js/agents/stages/deepsearch/tools/task/CLAUDE.md）

- **职责**：启动并管理子代理任务（async/sync），写入共享上下文。
- **边界**：任务生命周期管理，不处理具体任务内容。

###### Write-Report 工具（js/agents/stages/deepsearch/tools/write-report/CLAUDE.md）

- **职责**：报告创建/增量编辑/审查/提交与门槛校验。
- **边界**：报告写作工具，不管理检索与规划。

##### DeepSearch Utils（js/agents/stages/deepsearch/utils/CLAUDE.md）

- **职责**：StageApi 封装、预算/用量归一化、输出清洗与 TODO 规范化。
- **边界**：工具与规范层，不处理业务流程。

#### Design（js/agents/stages/design/CLAUDE.md）

- **职责**：PPT/幻灯片生成与设计流程（规划→生成→精调→完成）。
- **边界**：设计阶段封装，不下沉至 runtime/core。
- **子域**：generators/dsl/refiner/subagents/edit-mode/reviewer/runtime/shared。

##### Design Shared（js/agents/stages/design/shared/CLAUDE.md）

- **职责**：设计阶段共享工具（DSL/HTML 解析、错误分类、安全 emit）。
- **边界**：轻量工具层，不承担流程逻辑。

##### Design Runtime（js/agents/stages/design/runtime/CLAUDE.md）

- **职责**：设计阶段运行时支撑（阶段编排、规划/分析/编辑/视觉填充）。
- **边界**：仅服务 Design 阶段，不扩展为全局 runtime。

##### Design Generators（js/agents/stages/design/generators/CLAUDE.md）

- **职责**：设计令牌、布局、图像/SVG 与批量生成器。
- **边界**：内容生成层，不涉及流程控制。

##### Design DSL（js/agents/stages/design/dsl/CLAUDE.md）

- **职责**：SlideIntent/Layout JSON → HTML DSL 的构建与规则管理。
- **边界**：DSL 构建层，不参与渲染与执行。

##### Design Subagents（js/agents/stages/design/subagents/CLAUDE.md）

- **职责**：SlideSubAgent/VisualSubAgent 与资产注册表（AssetRegistry）。
- **边界**：子代理产出单页/视觉填充，不负责主流程编排。

##### Design Refiner（js/agents/stages/design/refiner/CLAUDE.md）

- **职责**：QA 校验、ReAct 精调与自动修复编排。
- **边界**：质量修复层，不改变规划逻辑。

##### Design Reviewer（js/agents/stages/design/reviewer/CLAUDE.md）

- **职责**：基于 DSL 统计的一致性审查与评分，并给出修复建议。
- **边界**：审查与建议，不直接改写流程。

##### Design Edit Mode（js/agents/stages/design/edit-mode/CLAUDE.md）

- **职责**：交互式编辑模式与撤销/重做历史。
- **边界**：交互与编辑工具层，不参与自动生成主流程。

##### Design Banana（js/agents/stages/design/banana/CLAUDE.md）

- **职责**：实验性批量图像生成（整套 slide 图片）。
- **边界**：实验功能，非主流程。

#### TextPrep（js/agents/stages/textprep/CLAUDE.md）

- **职责**：长文本预处理与 ContentPackage 生成（TP1-TP6）。
- **边界**：预处理与校验阶段，不负责检索与报告生成。

### Ingest 文档摄取（js/agents/ingest/CLAUDE.md）

- **职责**：多格式文档/媒体摄取，输出标准化 ParsedDocument（markdown/chunks/assets）。
- **边界**：摄取与解析，不负责检索与分析策略。

#### Ingest Adapters（js/agents/ingest/adapters/CLAUDE.md）

- **职责**：多格式文档解析适配器集合（PDF/DOCX/PPTX/HTML/EPUB/音视频/代码等）。
- **边界**：解析与标准化，不负责检索或分析流程。

### Retrieval 检索（js/agents/retrieval/CLAUDE.md）

- **职责**：BM25/向量/混合检索与 MMR 重排、ReadAround 扩展。
- **边界**：检索引擎，不负责业务阶段编排。

### LLM 层（js/agents/llm/CLAUDE.md）

- **职责**：模型路由、provider 适配、限流与多模态支持。
- **边界**：模型调用层，不包含业务逻辑。

### MCP 协议（js/agents/mcp/CLAUDE.md）

- **职责**：MCP 客户端/Provider/Transport，统一工具调用协议。
- **边界**：协议与传输层，不做具体工具实现。

### VFS（js/agents/vfs/CLAUDE.md）

- **职责**：跨平台虚拟文件系统（Memory/OPFS/Storage/NodeFS）。
- **边界**：文件抽象层，不处理上层业务。

### Skills（js/agents/skills/CLAUDE.md）

- **职责**：Skill Markdown 加载、注册与沙箱执行适配。
- **边界**：技能管理层，不负责工具执行。

### Storage（js/agents/storage/CLAUDE.md）

- **职责**：RunStore 运行记录/事件/工件持久化与导出。
- **边界**：存储与导出层，不含业务逻辑。

### Shared（js/agents/shared/CLAUDE.md）

- **职责**：跨模块共享工具、契约与平台能力（日志、预算、存储安全、WASM 支持等）。
- **边界**：仅提供基础能力，不包含业务流程或运行时编排。

#### Shared Archive（js/agents/shared/archive/CLAUDE.md）

- **职责**：差量快照与检查点迁移，提供归档存取与恢复。
- **边界**：归档与快照管理，不处理业务状态语义。

#### Shared Contracts（js/agents/shared/contracts/CLAUDE.md）

- **职责**：RPC/LLM/Tool 结果等边界结构验证与资源生命周期契约。
- **边界**：边界校验，不做深度业务校验。

#### Shared Embeddings（js/agents/shared/embeddings/CLAUDE.md）

- **职责**：EmbeddingService 与向量索引（VectorIndex/HnswLite）。
- **边界**：仅提供嵌入与索引能力，不负责检索策略编排。

#### Shared Tokenizers（js/agents/shared/tokenizers/CLAUDE.md）

- **职责**：自适应 token 计数（启发式 + tiktoken/WASM）。
- **边界**：计数器能力，不涉及调度策略。

#### Shared Utils（js/agents/shared/utils/CLAUDE.md）

- **职责**：通用工具集合（JSON、错误处理、缓存、熔断、存储安全、响应限制等）。
- **边界**：仅复用工具，不持有运行时状态。

### Prompts（js/agents/prompts/CLAUDE.md）

- **职责**：按阶段组织提示词，提供加载、渲染与注册表。
- **边界**：模板管理层，不包含业务逻辑。
- **约定**：按阶段目录命名，支持变量插值与格式化器管线。

#### Prompts Formatters（js/agents/prompts/formatters/CLAUDE.md）

- **职责**：模板格式化器与安全转义，支持 `{{var|formatter}}` 渲染管道。
- **边界**：仅处理格式化与转义，不管理提示词内容。

### Plugins（js/agents/plugins/CLAUDE.md）

- **职责**：内置插件集合，覆盖压缩、调试、服务注册等核心扩展。
- **边界**：插件实现扩展能力，但不改变内核边界。

#### Plugins: Compression（js/agents/plugins/compression/CLAUDE.md）

- **职责**：将 Cicada/Watchdog 作为 Kernel 插件提供压缩与监控服务。
- **边界**：插件包装层，不替代 runtime/compression 的实现细节。

#### Plugins: Debug（js/agents/plugins/debug/CLAUDE.md）

- **职责**：运行时检查器与日志插件，面向开发排障。
- **边界**：仅暴露观测能力，不影响业务流程。

#### Plugins: Services（js/agents/plugins/services/CLAUDE.md）

- **职责**：LLM/MCP/调度/VFS 服务插件，统一挂载到 `kernel.services`。
- **边界**：服务注册与事件流桥接，不实现具体业务。

### SDK（js/agents/sdk/CLAUDE.md）

- **职责**：面向应用层的 Agent 构建/配置 API（AgentBuilder/AgentFactory）。
- **边界**：高层 API 封装，不下沉到内核实现。

#### SDK Examples（js/agents/sdk/examples/CLAUDE.md）

- **职责**：SDK 用法示例，覆盖能力注册、事件/Hook、子代理、记忆/回溯与韧性流程。
- **边界**：演示与学习入口，不参与生产逻辑。

### Eval（js/agents/eval/CLAUDE.md）

- **职责**：评估 harness 与统计（pass@k/pass^k），支持 deterministic/LLM graders。
- **边界**：评估框架，不影响运行时流程。

#### Eval Graders（js/agents/eval/graders/CLAUDE.md）

- **职责**：EvalHarness 的评分器实现（deterministic/LLM judge/composite/content）。
- **边界**：评估与打分，不改变被测系统行为。

### Testing（js/agents/testing/CLAUDE.md）

- **职责**：Mock 测试环境（Model/MCP/EventBus/Server/Scenario）。
- **边界**：测试辅助，不进入生产路径。

### CLI（js/agents/cli/CLAUDE.md）

- **职责**：调试/演示脚本（demo、deepsearch、memory）。
- **边界**：开发工具，不参与库运行时。

## 架构评审：可改进点与风险

### P1（优先处理）
- **内核/兼容层过重**：core/kernel 兼容层污染内核职责，建议彻底迁移或隔离到独立 compat 模块。
- **Runtime 过宽**：compression/memory/telemetry 等长期“必带”，建议插件化或拆层，减小核心运行时表面积。
- **构造参数爆炸**：sdk/agent-factory 依赖注入过多，建议分组或 builder 化，降低耦合与测试成本。

### P2（应逐步改进）
- **类型与工具函数分散**：typedef 与工具函数散落业务文件，建议集中到 shared/utils 或 types 模块。
- **Shared 职责混杂**：embeddings/contracts/archive 与 retrieval/runtime/storage 边界混合，建议归档整理。
- **Stages 内 runtime 命名冲突**：`stages/*/runtime` 与顶层 runtime 易混淆，建议改名为 `internal/` 或 `helpers/`。
- **权限/Hook/Middleware 边界需明确**：三者功能重叠，需明确执行顺序与优先级文档。

### P3（可选优化）
- **状态机硬编码**：可引入配置或轻量状态机库提升可维护性。
- **API 表面积偏大**：考虑分层导出与预构建入口，降低入门成本。

## 结论与建议

- 架构方向正确：微内核 + 插件化 + 跨平台的分层设计清晰，阶段与子系统边界基本明确。
- 主要问题集中在"边界侵蚀与表面积膨胀"：Runtime/Shared/Stages 的职责范围需进一步压缩和命名清晰化。

### 实测数据 (2026-01-19)

| 指标 | 当前值 | 健康值 | 差距 |
|------|--------|--------|------|
| Runtime 子目录 | **28** | <10 | -18 |
| Runtime 文件数 | **128** | <50 | -78 |
| runtime/index.js 导出行 | **45** | <15 | -30 |
| "阴影 runtime" 目录 | **2** | 0 | -2 |

### 改进路线图

详见 `ARCHITECTURE-ISSUES.md` 中的 **Linus 式架构改进路线图**:

| 阶段 | 目标 | 预估时间 |
|------|------|----------|
| **Phase 0** | 重命名 `stages/*/runtime` → `stages/*/internal` | 30 分钟 |
| **Phase 1** | Runtime 瘦身，可选能力插件化 | 2-3 天 |
| **Phase 2** | 精简 runtime/index.js 导出 | 1 天 |
| **Phase 3** | Stage 通过接口解耦 Runtime 内部 | 2 天 |
| **Phase 4** | typedef 集中、工具函数整理、大文件拆分 | 持续 |
