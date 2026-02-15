# Agent 微内核架构 - 断裂点扫描报告

**扫描日期**: 2026-02-14
**扫描范围**: js/agents 微内核架构
**扫描深度**: Very Thorough

---

## 执行摘要

本次扫描对 js/agents 微内核架构进行了系统性的断裂点分析，重点检查数据持久化与内存读取之间的断裂问题。迭代至 Phase 10 后，累计发现并修复 **63 个断裂点**，**Phase 1-10 已全部修复**。

**断裂点定义**：数据写入持久化层（VFS/Storage/IndexedDB）但未同步到内存索引，导致读操作只查内存而无法访问持久化数据，或初始化时未从持久层 hydrate 到内存。

---

## 断裂点汇总

### 按 Phase 统计

| Phase | 数量 | 状态 |
|------|------|------|
| Phase 1-6 | 26 | ✅ 已修复 |
| Phase 7 | 10 | ✅ 已修复 |
| Phase 8 | 7 | ✅ 已修复 |
| Phase 9 | 10 | ✅ 已修复 |
| Phase 10 | 10 | ✅ 已修复 |
| **总计** | **63** | **✅ Phase 1-10 全部修复** |

### 初始扫描严重程度分布（Phase 1 基线）

| 严重程度 | 数量 | 关键模块 |
|---------|------|---------|
| 🔴 高 | 5 | StateBus, Retrieval, ToolRegistry, Skills, Ingest |
| 🟡 中 | 4 | EventBus, ServiceBus, MessageBus, Compression |
| 🟠 低 | 2 | Telemetry, MemoryStore L0-L2 |
| **总计** | **11** | - |

---

## 🔴 高严重程度断裂点（5个）

### 1. StateBus 快照未持久化

**文件**: `js/agents/core/state-bus.js`
**行号**: 199-484（快照管理）

**问题描述**:
- 快照存储在内存 Map `_snapshots` 中（第199行）
- 无持久化机制，重启后全部丢失
- `snapshot()` 方法只做内存存储，无 VFS/Storage 写入
- `rollback()` 依赖内存快照，无法恢复历史状态

**影响范围**:
- 跨会话状态恢复失效
- 无法实现状态时间旅行调试
- Agent 重启后无法回滚到之前的状态

**修复建议**:
- 集成 Archive 或 L3Storage 持久化快照
- 在 `snapshot()` 时异步写入 VFS
- 在 `init()` 时从 VFS 恢复快照索引

**修复状态**: ✅ 已修复（2026-02-14）
- 添加 `_archive` 和 `_runId` 字段
- `snapshot()` 实现双写（内存 + Archive）
- `deleteSnapshot()` 同时删除内存和 Archive
- 添加 `init()` 方法从 Archive hydrate 快照

---

### 2. Retrieval 索引完全未持久化

**文件**:
- `js/agents/retrieval/bm25.js`（第1-100行）
- `js/agents/retrieval/embeddings/vector-index.js`（第82-100行）

**问题描述**:
- BM25 索引只在内存中构建，无序列化/持久化
- Vector 索引存储在内存 Map `_rows` 中，无 VFS 写入
- 每次重启需要重新构建索引（成本高）
- 无增量更新机制

**影响范围**:
- 文档检索性能严重下降（每次重启需重建）
- 无法跨会话保留检索优化
- 大规模文档集合无法有效管理

**修复建议**:
- 实现 BM25 索引序列化（JSON/Binary）
- 集成 L3Storage 存储向量索引
- 支持增量索引更新

**修复状态**: ⏳ 待修复

---

### 3. ToolRegistry 执行历史未持久化

**文件**: `js/agents/runtime/core/tool-registry.js`
**行号**: 233-550（ToolRegistry 主类）

**问题描述**:
- 工具调用历史无任何持久化机制
- 统计信息 `_stats` 只在内存中（第49行）
- 无法跨会话查询工具使用情况
- RetrievalEngine 无法 recall 历史工具调用

**影响范围**:
- 无法分析工具使用模式
- 无法实现工具调用审计
- 无法优化工具选择策略

**修复建议**:
- 集成 Archive 存储工具调用记录
- 在 EventBus 中持久化 `tool:call:*` 事件
- 实现工具调用索引以支持快速查询

**修复状态**: ⏳ 待修复

---

### 4. Skills 缓存未持久化

**文件**: `js/agents/skills/manager.js`
**行号**: 37-103（缓存管理）

**问题描述**:
- Skills 缓存存储在内存 Map `cacheByDir` 中（第37行）
- TTL 仅 5 分钟（第39行），无持久化
- 浏览器端 user-store 缓存也只在内存中
- 每次会话需重新加载 Skills manifest

**影响范围**:
- Skills 加载性能差（频繁网络请求）
- 无法跨标签页共享 Skills 缓存
- 离线场景无法使用 Skills

**修复建议**:
- 集成 VFS 或 IndexedDB 持久化 Skills
- 实现 manifest 版本控制
- 支持离线 Skills 加载

**修复状态**: ⏳ 待修复

---

### 5. Ingest 处理状态未持久化

**文件**: `js/agents/ingest/ingest-stage.js`
**行号**: 1-150（主流程）

**问题描述**:
- 文档处理状态无持久化机制
- 无法恢复中断的处理流程
- 大文件处理失败后无法断点续传
- 处理进度无法跨会话保留

**影响范围**:
- 大文件摄取不可靠
- 无法实现可恢复的处理流程
- 资源浪费（重复处理）

**修复建议**:
- 实现处理检查点（每个文档/chunk）
- 集成 Archive 存储处理状态
- 支持断点续传

**修复状态**: ⏳ 待修复

---

## 🟡 中严重程度断裂点（4个）

### 6. EventBus 历史记录未持久化

**文件**: `js/agents/core/event-bus.js`
**行号**: 139-227（历史管理）

**问题描述**:
- 事件历史只在内存 `_history` 中（第140行）
- 重启后历史丢失，无法 replay
- `replay()` 依赖外部 persistenceAdapter，但内部历史无持久化
- 背压事件也无持久化

**影响范围**:
- 无法调试历史事件流
- 无法实现事件审计
- 无法恢复中断的事件处理

**修复建议**:
- 自动持久化事件到 Archive
- 实现事件流快照
- 支持事件过滤持久化

**修复状态**: ⏳ 待修复

---

### 7. ServiceBus 统计信息未持久化

**文件**: `js/agents/core/service-bus.js`
**行号**: 48-315（统计管理）

**问题描述**:
- 服务统计 `_stats` 只在内存中（第48行）
- 无法跨会话分析服务性能
- 无法实现服务健康监控

**影响范围**:
- 无法分析服务性能趋势
- 无法实现服务降级决策

**修复建议**:
- 集成 Telemetry 持久化统计
- 实现服务性能指标导出

**修复状态**: ⏳ 待修复

---

### 8. MessageBus RPC 缓存未持久化

**文件**: `js/agents/core/message-bus.js`
**行号**: 190-462（RPC 管理）

**问题描述**:
- 在途请求缓存 `_inflightRequests` 只在内存中（第191行）
- 无法恢复中断的 RPC 调用
- 幂等性缓存无持久化

**影响范围**:
- RPC 调用不可靠
- 无法实现真正的幂等性

**修复建议**:
- 集成 Archive 存储 RPC 状态
- 实现 RPC 重试日志

**修复状态**: ⏳ 待修复

---

### 9. Compression 决策未持久化

**文件**: `js/agents/plugins/compression/impl/cicada-compressor.js`

**问题描述**:
- ProactiveCompressor 决策无持久化
- QualityMonitor 评分历史无持久化
- 无法跨会话优化压缩策略

**影响范围**:
- 无法学习最优压缩时机
- 无法分析压缩效果

**修复建议**:
- 集成 Telemetry 记录压缩决策
- 实现压缩效果评分持久化

**修复状态**: ⏳ 待修复

---

## 🟠 低严重程度断裂点（2个）

### 10. Telemetry 数据未持久化

**文件**: `js/agents/runtime/telemetry/`

**问题描述**:
- Token 统计无持久化
- Trace 上下文无持久化
- 无法跨会话分析性能

**影响范围**:
- 无法进行长期性能分析

**修复建议**:
- 集成 Archive 存储遥测数据
- 实现遥测数据导出

**修复状态**: ⏳ 待修复

---

### 11. L0/L1/L2 MemoryStore 层未持久化

**文件**: `js/agents/plugins/memory/memory-store.impl.core.js`

**问题描述**:
- L0 层（systemPrompt/taskGoal/todos）只在内存中
- L1 层（messages/signals/decisions）只在内存中
- L2 层（historySummary/stageSummaries）只在内存中
- 只有 L3 层有持久化

**影响范围**:
- 中间层状态无法跨会话保留
- 需要重新构建 L0-L2 状态

**修复建议**:
- 集成 Archive 持久化 L0-L2 层
- 实现分层快照

**修复状态**: ⏳ 待修复

---

## 修复优先级建议

### Phase 1（关键）- ✅ 已完成 (2026-02-14)
1. ✅ StateBus 快照持久化 → 影响状态恢复 (edf910ec)
2. ✅ Retrieval 索引持久化 → 影响检索性能 (c0b4172e)
3. ✅ ToolRegistry 历史持久化 → 影响审计 (b8365e64)

### Phase 2（重要）- ✅ 已完成 (2026-02-14)
4. ✅ Skills 缓存持久化 → 影响加载性能 (817aed1f)
5. ✅ Ingest 状态持久化 → 影响可靠性 (81666b2b)
6. ✅ EventBus 历史持久化 → 影响调试 (960d350e)

### Phase 3（优化）- ✅ 已完成 (2026-02-14)
7. ✅ ServiceBus 统计持久化 → 影响统计数据恢复 (f32bee20)
8. ✅ MessageBus RPC 持久化 → 影响 RPC 历史追踪 (8f090f97)
9. ✅ Compression 决策持久化 → 影响压缩策略恢复 (d6a625ad)
10. ✅ Telemetry 数据持久化 → 影响遥测数据分析 (9a4fecc5)
11. ✅ MemoryStore L0-L2 持久化 → 影响记忆层恢复 (1c19d78f)

### Phase 7 修复（10个断裂点）

| # | 模块 | 问题 | Commit |
|---|------|------|--------|
| 1 | IngestStage | 初始化失败处理 | 427342e8 |
| 2 | TabCoordinator | 选主脑裂 | ee31f521 |
| 3 | SkillsManager | 缓存初始化竞态 | d997aca0 |
| 4 | AgentCheckpointStore | 索引锁竞态 | e1b1dc52 |
| 5 | L3Storage | 初始化超时控制 | d997aca0 |
| 6 | RetrievalRouter | 参数归一化 | f8599949 |
| 7 | EventBus | 订阅泄漏风险 | d3ab7d17 |
| 8 | L3Storage | 索引恢复字段校验 | c1fd2897 |
| 9 | StateEngine | 快照恢复版本校验 | a22346f1 |
| 10 | CodeSearchIndexStore | 缓存版本管理 | 0c8c885c |

### Phase 8 修复（7个断裂点）

| # | 模块 | 问题 | Commit |
|---|------|------|--------|
| 1 | SkillsManager | 初始化Promise竞态 | 5fc29cee |
| 2 | IngestStage | 初始化Promise竞态 | 30b4acd4 |
| 3 | ProcessCoordinator | 事件监听器清理 | 1a7a0201 |
| 4 | SymbolIndexer | 缓存版本管理 | c3ee42de |
| 5 | L3Storage | 增量索引时间戳同步 | cc537237 |
| 6 | Orchestrator | 并发等待器清理 | 387a525d |
| 7 | DesignBlackboard | 订阅清理时序 | 1a7a0201 |

### Phase 9 修复（10个断裂点）

| # | 模块 | 问题 | Commit |
|---|------|------|--------|
| 1 | EventBus | 背压定时器泄漏 | a04de971 |
| 2 | SandboxPool | 内存检查定时器泄漏 | 47984fb2 |
| 3 | WebSocketTransport | 心跳/重连定时器泄漏 | aea4d9ad |
| 4 | TabCoordinator | BroadcastChannel监听器泄漏 | b6b96cae |
| 5 | WorkerRPC | Worker监听器泄漏 | 47984fb2 |
| 6 | MessageManager | Promise泄漏 | 92ceef68 |
| 7 | WorkerPool | 事件监听器泄漏 | 896aac7a |
| 8 | RateLimit | 泵机制死锁 | 47984fb2 |
| 9 | ModelRouter | 熔断器状态不一致 | 47984fb2 |
| 10 | FileLock | AbortSignal泄漏 | aea4d9ad |

### Phase 10 修复（10个断裂点）

| # | 模块 | 问题 | Commit |
|---|------|------|--------|
| 1 | MessageBus | _initPromise永久pending | 20cb113f |
| 2 | MessageBus | _inflightRequests Map泄漏 | 20cb113f |
| 3 | HttpMcpTransport | 事件监听器未清理 | 30bba16d |
| 4 | SseMcpTransport | 事件监听器未清理 | 30bba16d |
| 5 | RunStoreCache | 缓存一致性 | e4c2c1c2 |
| 6 | LruCache | 定时器泄漏 | e4c2c1c2 |
| 7 | VFS operations | Promise链锁泄漏 | 86cf8561 |
| 8 | PromptLoader | 缓存竞态 | 86cf8561 |
| 9 | CircuitBreaker | 状态转换竞态 | c58f8046 |
| 10 | OverflowRecovery | 重试状态未持久化 | c58f8046 |

---

## 通用修复模式

所有断裂点可采用统一的修复模式：

```
数据写入 → 内存索引 ↔ VFS/Storage 持久层
           ↓
        初始化时 hydrate
```

**核心原则**：
1. **双写模式**：写入时同时更新内存和持久层
2. **Hydrate 模式**：初始化时从持久层恢复到内存
3. **向后兼容**：如果没有提供持久化后端，行为不变
4. **异步处理**：持久化操作异步执行，不阻塞主流程
5. **错误容忍**：持久化失败不影响内存操作

**建议方案**：
- 利用现有 Archive 和 L3Storage 基础设施
- 实现统一的持久化适配器接口
- 支持增量更新和差量快照
- 集成 TabCoordinator 实现跨标签页同步

---

## 修复进度跟踪

| 断裂点 | 严重程度 | 修复状态 | 修复日期 | 备注 |
|--------|---------|---------|---------|------|
| StateBus 快照 | 🔴 高 | ✅ 已修复 | 2026-02-14 | 集成 Archive，实现双写和 hydrate (edf910ec) |
| Retrieval 索引 | 🔴 高 | ✅ 已修复 | 2026-02-14 | VectorIndex 添加 serialize/deserialize (c0b4172e) |
| ToolRegistry 历史 | 🔴 高 | ✅ 已修复 | 2026-02-14 | 集成 Archive，异步持久化工具调用历史 (b8365e64) |
| Skills 缓存 | 🔴 高 | ✅ 已修复 | 2026-02-14 | 集成 Archive，实现双写和 hydrate (817aed1f) |
| Ingest 状态 | 🔴 高 | ✅ 已修复 | 2026-02-14 | 集成 Archive，异步持久化处理状态 (81666b2b) |
| EventBus 历史 | 🟡 中 | ✅ 已修复 | 2026-02-14 | 集成 Archive，异步持久化事件历史 (960d350e) |
| ServiceBus 统计 | 🟡 中 | ✅ 已修复 | 2026-02-14 | 集成 Archive，异步持久化统计数据 (f32bee20) |
| MessageBus RPC | 🟡 中 | ✅ 已修复 | 2026-02-14 | 集成 Archive，异步持久化 RPC 历史 (8f090f97) |
| Compression 决策 | 🟡 中 | ✅ 已修复 | 2026-02-14 | 集成 Archive，异步持久化压缩决策 (d6a625ad) |
| Telemetry 数据 | 🟠 低 | ✅ 已修复 | 2026-02-14 | 集成 Archive，异步持久化遥测数据 (9a4fecc5) |
| MemoryStore L0-L2 | 🟠 低 | ✅ 已修复 | 2026-02-14 | 集成 Archive，L0-L2 层持久化 (1c19d78f) |

---

## 相关文档

- [L3Storage VFS 后端 recall 修复](../js/agents/plugins/memory/AUDIT_HISTORY.md)
- [Agent 微内核架构文档](../js/agents/CLAUDE.md)
- [Archive 持久化系统](../js/agents/core/archive/README.md)

---

**扫描工具**: Claude Code Explore Agent
**扫描模式**: Very Thorough
**报告生成**: 2026-02-14
