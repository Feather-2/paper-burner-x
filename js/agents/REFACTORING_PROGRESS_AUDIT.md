# js/agents 重构落地进度审计报告 (Phase 1 → Phase 3)

> **审计人**：Linus Torvalds (Agent Mode)
> **当前进度**：约 90% (Phase 3 完成，中期架构演进已落地)
> **状态**：P0/P1/Medium-term 基本完成 / Long-term Optimization Pending

---

## 1. 落地成果总结 (Verified Changes)

### 1.1 安全性：从"裸奔"到"深渊隔离" (95%)
- **核心改进**：`LocalMcpProvider` 现已集成 `inspectUrlForProxy`，能自动识别并剥离敏感 Query Params (token, key, secret)。
- **Phase 2 新增**：`matchWildcard` ReDoS 漏洞修复（双指针算法）；Cicada schema versioning 确保存档兼容。
- **Phase 3 新增**：`SubagentRegistry` 输出检疫机制，跨 Agent 数据交换自动校验和消毒。
- **Linus 评价**：安全边界已经闭合，包括 Agent 间的数据流。

### 1.2 性能隔离：计算权重的上下文切换 (90%)
- **核心改进**：VFS 层成功引入 `createUnifiedDiffAsync` 与 `diff.worker.js`。
- **Phase 2 新增**：MemoryStore 增量快照（dirty flags），VectorIndex 时间分区过滤。
- **Phase 3 新增**：`compression.worker.js` + `compression-async.js` 将 SESSION_HISTORY 压缩移至 Worker。
- **Linus 评价**：主线程终于可以喘口气了。

### 1.3 准确度：从"盲目估算"到"字符感知" (70%)
- **核心改进**：`estimateTokenCount` 弃用了 1:4 的粗暴比例，改为基于 `charCodeAt` 扫描的 CJK 加权算法 (1.6x)。
- **Linus 评价**：里程表准了，引擎才敢全速跑。

### 1.4 可观测性：逻辑震荡与时钟漂移 (90%)
- **Phase 2 新增**：
  - Watchdog Jaccard 相似度检测逻辑震荡
  - Replay-controller 逻辑序列号（seq > ts > insertOrder）
  - tree-sitter-wasm 僵尸 Promise 修复
- **Linus 评价**：Agent 不再会"脑死亡"而无人察觉。

### 1.5 缓存优化：I/O 饥饿缓解 (NEW - 85%)
- **Phase 3 新增**：
  - `LRUCache` 通用缓存（TTL + 统计 + 批量操作）
  - `retrieval-router.js` 集成检索结果缓存和 chunk 缓存
  - `getRetrievalCacheStats()` / `clearRetrievalCaches()` / `warmChunkCache()` API
- **Linus 评价**：热点数据不再每次都从头读了。

---

## 2. 已修复的"深层顽疾" (Fixed in Phase 2 & 3)

### 2.1 异步竞态的"刹车失灵" (AgentLoop) ✅ 已修复
- **修复**：`flushCompression()` 现已作为模型调用前的强制同步屏障。
- **代码证据**：`deepsearch/model.js`、`design/model.js` 的 `flushBeforeCall()`

### 2.2 Schema 版本缺失 ✅ 已修复
- **修复**：Cicada archive 存储 `schemaVersion: "1.0"`，restore 校验版本兼容性。
- **代码证据**：`cicada-compressor.js`

### 2.3 向量检索暴力扫描 ✅ 已缓解
- **修复**：VectorIndex 支持 hot/warm/cold 时间分区，search 可指定 partitions 过滤。
- **代码证据**：`vector-index.js`

### 2.4 Checkpoint 全量 deepClone ✅ 已缓解
- **修复**：MemoryStore 增量快照（dirty flags + `toSnapshot({incremental:true})`）。
- **代码证据**：`memory-store.js`

### 2.5 状态契约的"信任漏洞" ✅ 已修复 (Phase 3)
- **修复**：`SubagentRegistry` 工厂函数自动包装，输出经过 schema 校验和消毒。
- **代码证据**：`sdk/SubagentRegistry.js` - `validateOutput()` / `quarantineOutput()`

### 2.6 检索系统的"I/O 饥饿" ✅ 已修复 (Phase 3)
- **修复**：`retrieval-router.js` 集成 LRU Cache，缓存检索结果和 chunk 文本。
- **代码证据**：`retrieval/retrieval-router.js` + `shared/utils/lru-cache.js`

### 2.7 压缩主线程阻塞 ✅ 已修复 (Phase 3)
- **修复**：`compression-async.js` + `compression.worker.js` 实现 Web Worker 压缩。
- **代码证据**：`runtime/compression/compression-async.js`、`runtime/core/agent-loop.js:524`

---

## 3. 依然存在的"长期优化" (Remaining Long-term Work)

### 3.1 全面 Worker 化（剩余部分）
- **现状**：diff 和 compression 已可选 Worker；glob/scan 仍在主线程。
- **指令**：参照 compression-async 模式，继续迁移正则扫描任务。

### 3.2 真正的向量索引
- **现状**：VectorIndex 仍是 O(N) 扫描 + 时间分区过滤。
- **指令**：引入 HNSW 或 IVF-Flat 结构实现真正的 ANN。

### 3.3 增量持久化
- **现状**：Checkpoint 最小化策略 + 增量快照接口已就绪，但非真正的 delta persistence。
- **指令**：实现基于 Merkle tree 的真正增量存储。

---

## 4. Linus 的 Phase 3 评语

> "中期架构演进已经落地：跨 Agent 数据检疫、检索缓存、压缩 Worker 化。系统的工程成熟度从'原型'跨入了'工业级'的门槛。剩下的是性能微调，不再是救火。"

---
*更新时间：2026-01-03*
*由 Linus Torvalds (Agent Mode) 签发*
