# Paper-Burner

**浏览器里的自动化科研实验室** —— 基于微内核架构的 AI4Sci 应用。

## 定位

- **点开即用**：无需安装，浏览器直接运行
- **边缘算力**：计算在用户浏览器，数据不离港
- **一站式产出**：从原始素材到专业 PPT 的极短链路

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **Language** | JavaScript + JSDoc | 无 TypeScript 编译，最大化跨端兼容 |
| **Runtime** | ES Modules | Browser / Node.js / Deno / Bun |
| **Agent Core** | 微内核架构 | 四总线 (EventBus/StateBus/ServiceBus/MessageBus) + Plugin + Stages |
| **Protocol** | MCP | Model Context Protocol，标准化工具调用 |
| **LLM** | ModelRouter | 多模型路由，速率限制，Token 溢出恢复 |
| **Retrieval** | BM25 + Vector + MMR | 混合检索 + 多样性重排 |
| **Storage** | VFS 抽象 | Memory / OPFS / IndexedDB / LocalStorage |
| **Rendering** | pptxgenjs + Custom | PPT 生成与编辑 |

## Agent 微内核架构 (js/agents)

```
┌─────────────────────────────────────────────────────────────────┐
│                         SDK Layer                               │
│  createAgent() / AgentBuilder / DeepSearchAgentLoop / Design    │
├─────────────────────────────────────────────────────────────────┤
│                      Stages (业务阶段)                           │
│  DeepSearch │ Design (PPT) │ CodeSearch │ TextPrep              │
├─────────────────────────────────────────────────────────────────┤
│                      Runtime (运行时)                            │
│  AgentLoop │ Orchestrator │ ToolRegistry │ Hooks │ Compression  │
│  Telemetry │ Memory │ Parallel │ DI │ Safety                    │
├─────────────────────────────────────────────────────────────────┤
│                      Core (微内核)                               │
│  Kernel │ EventBus │ StateBus │ ServiceBus │ MessageBus         │
│  Plugin │ Presets │ CRDT │ Sandbox                              │
├─────────────────────────────────────────────────────────────────┤
│                   Infrastructure (基础设施)                      │
│  VFS │ LLM (ModelRouter) │ MCP │ Retrieval │ Ingest │ Skills    │
│  Prompts │ Shared (Utils/Embeddings/Tokenizers)                 │
└─────────────────────────────────────────────────────────────────┘
```

### 核心能力

| 能力 | 模块 | 说明 |
|------|------|------|
| **四总线** | core | EventBus (Lamport Clock) + StateBus (响应式) + ServiceBus (Retry/Cache) + MessageBus (RPC) |
| **插件系统** | core/plugins | createPlugin + 预设 (minimal/standard/deepsearch/production) |
| **多 Agent 编排** | runtime | Orchestrator + SchedulingMode (Serial/Parallel/Priority) |
| **工具执行** | runtime | ToolRegistry + ToolExecutor + Pre/Post Hooks |
| **上下文压缩** | runtime/compression | Cicada + Watchdog，防 Token 溢出 |
| **文档摄取** | ingest | PDF/DOCX/PPTX/HTML/Markdown/EPUB/Audio/Video 适配器 |
| **混合检索** | retrieval | BM25 (关键词) + Vector (语义) + Grep (模式) + MMR (多样性) |
| **技能系统** | skills | Markdown 定义，三级加载 (repo > user > system)，沙箱执行 |
| **VFS** | vfs | 跨平台文件系统 (Memory/OPFS/Storage) |
| **MCP** | mcp | 本地 + Nexus 远程端点，标准化工具调用 |

### 预构建 Stages

| Stage | 入口 | 职责 |
|-------|------|------|
| **DeepSearch** | `DeepSearchAgentLoop` | 多轮文档分析、任务规划、报告生成 |
| **Design** | `DesignAgentLoop` | PPT/幻灯片生成，支持编辑模式 |
| **CodeSearch** | `CodeSearchStage` | 符号索引、语义检索、三阶段 (规划/执行/总结) |

## PPT 模块 (js/ppt) - 拳头功能

```
┌─────────────────────────────────────────────────────────────────┐
│                         Editor (编辑器)                          │
│  拖拽 │ 选择 │ 工具栏 │ 图层 │ 撤销/重做                         │
├─────────────────────────────────────────────────────────────────┤
│                       Generator (生成器)                         │
│  大纲解析 │ 布局引擎 │ 样式解析 │ 内容映射                        │
├─────────────────────────────────────────────────────────────────┤
│                       Renderers (渲染器)                         │
│  预览渲染 │ 主题系统 │ 动画                                      │
├─────────────────────────────────────────────────────────────────┤
│                         Core / DSL                               │
│  PPT 数据模型 │ 幻灯片 DSL 解析 │ pptxgenjs 导出                  │
└─────────────────────────────────────────────────────────────────┘
```

| 子模块 | 职责 |
|--------|------|
| **editor** | 在线编辑器（类 PowerPoint） |
| **generator** | PPT 生成引擎 |
| **renderers** | 幻灯片渲染器 |
| **dsl** | PPT DSL 解析器 |
| **dashboard** | PPT 管理仪表盘 |
| **model-config** | AI 模型配置 |
| **workflow** | PPT 生成工作流 |

## Chatbot 模块 (js/chatbot)

```
┌─────────────────────────────────────────────────────────────────┐
│                         UI Layer                                 │
│  聊天界面 │ 消息列表 │ 输入框 │ 工具结果展示                      │
├─────────────────────────────────────────────────────────────────┤
│                       Core Layer                                 │
│  ChatController │ MessageHandler │ StreamingAdapter              │
├─────────────────────────────────────────────────────────────────┤
│                      Strategy Layer                              │
│  RAG 策略 │ 直接问答 │ 多轮对话                                   │
├─────────────────────────────────────────────────────────────────┤
│                      Renderers                                   │
│  Markdown │ 代码块 │ 表格 │ 图表                                  │
└─────────────────────────────────────────────────────────────────┘
```

| 子模块 | 职责 |
|--------|------|
| **core** | ChatController, MessageHandler, StreamingAdapter |
| **ui** | 聊天界面组件 |
| **strategy** | 对话策略 (RAG/直接问答) |
| **renderers** | 消息渲染器 |
| **mcp** | MCP 协议集成 |

## Storage 模块 (js/storage)

```
StorageFacade (门面)
    ├── SettingsRepository      → 用户设置
    ├── ApiKeysRepository       → API 密钥
    ├── ResultsRepository       → 处理结果
    ├── ProcessedFilesRepository → 已处理文件
    └── AnnotationsRepository   → 标注数据
         ↓
    BaseRepository
         ↓
    BaseStorageAdapter
         ├── LocalStorageAdapter  (同步, 5MB)
         ├── IdbAdapter           (异步, 大容量)
         └── MemoryAdapter        (测试用)
```

## Processing 模块 (js/processing)

```
原始文档 → Markdown 处理器 → 公式处理器 → 参考文献提取 → 内容分块 → RAG 索引
```

| 组件 | 职责 |
|------|------|
| **markdown_processor** | Markdown 解析和渲染 |
| **formula_post_processor** | LaTeX 公式处理 |
| **reference-detector/extractor** | 参考文献检测和提取 |
| **reference-doi-resolver** | DOI 元数据解析 |
| **content-list-to-chunks** | RAG 用文档分块 |

## Core 模块 (js/core)

| 子模块 | 组件 | 职责 |
|--------|------|------|
| **api** | KeyProvider | API 密钥安全管理 |
| **file** | file-utils, zip-extractor | 文件格式检测, ZIP 解压 |
| **processing** | Semaphore, ProcessQueue | 并发控制, 任务队列 |
| **state** | DocumentStore, SelectionStore | 响应式状态管理 |

## UI 模块 (js/ui)

| 类别 | 组件 |
|------|------|
| **通知** | ui-notifications (Toast, Alert) |
| **管理界面** | key-manager-ui, reference-manager-ui, glossary-editor |
| **配置面板** | ui-model-panels, ocr-settings, ui-embedding-config |
| **布局** | toc_logic, sidebar-integration, immersive_layout |
| **其他** | lightbox, dock, chunk_compare |

> 每个组件同时提供 `.js` 和 `.esm.js` 双版本

## 辅助模块

| 模块 | 路径 | 职责 |
|------|------|------|
| **annotations** | `js/annotations/` | 文档标注系统 (高亮, 批注, 汇总) |
| **history** | `js/history/` | 历史记录管理, 导出, PDF 对比 |
| **api** | `js/api/` | API 服务层 (ai-api-service, model-detector) |
| **boot** | `js/boot/` | 启动逻辑 (CDN fallback, deps-loader, embedding 初始化) |
| **lib** | `js/lib/` | 第三方库 (jszip) |

## 模块索引

| 模块 | 详细文档 | 文件数 |
|------|----------|--------|
| **agents** | `js/agents/CLAUDE.md` | 544 |
| **ppt** | `js/ppt/CLAUDE.md` | - |
| **chatbot** | `js/chatbot/CLAUDE.md` | - |
| **storage** | `js/storage/CLAUDE.md` | - |
| **core** | `js/core/CLAUDE.md` | - |
| **ui** | `js/ui/CLAUDE.md` | - |
| **processing** | `js/processing/CLAUDE.md` | - |

## 当前状态

- ✅ Agent 微内核完成 (Kernel + 四总线 + Plugin + Stages)
- ✅ DeepSearch / Design / CodeSearch Stages 完成
- ✅ PPT 生成核心完成
- ✅ VFS / Retrieval / Ingest / Skills 完成
- ⏳ Agent-UI 契约层（进行中）
- ⏳ 集成测试与调试（进行中）

## 开发文档

- **PRD 索引**: `docs/prd-index.md`
- **AI4Sci 路线图**: `docs/prd-ai4sci-roadmap.md`
- **本地化 Skills**: `.skills/MANIFEST.json`
- **Agent 详细索引**: `js/agents/CLAUDE.md`

## 约定

- 使用 ES Modules (`"type": "module"`)
- JSDoc 类型注解 (`@typedef` / `@param` / `@returns`)
- 事件名格式：`domain:action` (如 `agent:step`, `llm:complete`)
- 服务名格式：camelCase
- 测试覆盖 ≥ 90%
