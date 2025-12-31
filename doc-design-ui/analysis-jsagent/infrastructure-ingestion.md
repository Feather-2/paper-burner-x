# Analysis: Infrastructure & Ingestion (基础设施与数据获取)

## 1. 架构 (Architecture)

### 多模态数据摄取 (`js/agents/ingest/`)
- **适配器模式**: `adapters/` 目录下实现了对 `pdf`, `pptx`, `docx`, `video`, `audio`, `code`, `epub`, `html` 等多种格式的专项提取逻辑。
- **资产管理 (`asset-manager.js`)**: 负责资产的去重与哈希计算。通过对大型数据进行采样签名（长度 + 前缀 + 后缀）而非全量哈希，极大提升了处理 TB 级文档库时的性能。
- **资产理解 (`asset-understanding.js`)**: 不仅是提取文本，还通过 LLM 对非文本资产（如图片、视频帧）进行结构化语义描述。
- **分块加载器 (`chunked-loader.js`)**: 针对超大型文档设计的流式加载与切片机制，确保内存占用平稳。
- **提取逻辑 (`extract-assets.js`)**: 专门从 Markdown 中识别并提取资产引用。

### 智能检索体系 (`js/agents/retrieval/`)
- **多算法混合**: 整合了传统全文检索（Grep）、排名算法（BM25）以及上下文感知检索（Readaround）。
- **检索路由 (`retrieval-router.js`)**: 根据用户问题的意图，自动选择最合适的检索工具链。
- **大纲构建 (`toc-builder.js`)**: 在检索前先构建文档的物理/逻辑大纲，帮助 Agent 进行“有导航的检索”。

### LLM 抽象层 (`js/agents/llm/`)
- **模型路由 (`model-router.js`)**: 实现了一套复杂的路由逻辑，能根据任务类型（文本生成、视觉识别、音频转录）自动分发给不同的 Provider（Anthropic, Whisper, ImageGen 等）。
- **Provider 系统**: 统一了 `whisper-provider.js`, `image-provider.js` 等接口，支持 Mock 模式进行离线测试。
- **桥接层 (`ppt-model-bridge.js`)**: 专门用于将通用的 LLM 输出适配为 PPT 领域的特定 DSL。

## 2. 优化 Trick (Optimization Tricks)

- **内容指纹采样**: 在 `asset-manager.js` 中，对超过 4KB 的原始数据采用采样策略，避免昂贵的长字符串 JSON 序列化。
- **视频帧抽样**: 在 `video-frames.js` 中采用关键帧抽样策略，避免将完整的视频流传给多模态模型，极大地降低了 Token 成本。
- **语义分块 (Semantic Chunking)**: 结合 `toc-builder` 的信息进行分块，保证了切片内容的语义完整性，优于简单的字符长度切片。
- **Provider 降级策略**: `model-router` 支持根据响应延迟或错误自动切换 Provider。

## 3. 对比 Claude Code (analysis-cc) 的优势与差距

- **优势**: 我们的 **多模态处理能力** 远超 Claude Code。Claude Code 主要关注文本和代码，而我们具备完整的视频、音频和复杂 Office 文档的摄取能力。
- **优势**: **混合检索架构** 更加灵活。Claude Code 深度绑定了 RipGrep，而我们支持 BM25 等更复杂的语义排名算法。
- **差距**: Claude Code 的 **Git 深度集成** 是其基础设施的核心（`src/git/`），而我们的基础设施目前对版本控制系统的感知较弱，更多关注于原始素材的处理。
- **改进点**: 建议引入 Claude Code 在 `src/prompt/cache.ts` 中的 Prompt 缓存哈希机制，优化我们大型 Prompt 拼接时的性能。
