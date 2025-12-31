# Storage 文件夹审查报告 (js/agents/storage)

## 1. 潜在问题清单

### 1.1 数据库架构与一致性 (Database Architecture)
- **缺乏数据库事务保护**: `RunStore.deleteRun` 分别在三个 Store 上执行操作（第 307 行）。如果在删除过程中浏览器崩溃或断电，会导致数据孤儿（例如 Run 被删了但相关的 Artifacts 还在），缺乏原子性保证。
- **复合索引的潜在性能隐患**: `byRunIdTypeSeq` 使用了复合 Key `[runId, type, seq]`（第 114 行）。虽然利于查询，但在大量写入 Artifacts 时，索引维护的开销会随着文档数的增加而显著上升，特别是在 IndexedDB 的低性能实现下。
- **Schema 迁移逻辑缺失**: `DB_VERSION = 1` 且 `onupgradeneeded` 仅处理了初始化（第 101 行）。随着系统迭代，如果需要新增字段或修改索引，目前的逻辑无法平滑处理旧版数据的迁移。

### 1.2 资源与配额管理 (Resource & Quota)
- **大对象序列化阻塞**: `saveArtifact` 中提到“避免对潜在的大型对象执行 `JSON.stringify`”（第 403 行）。然而，如果用户未显式传入 `bytes` 且触发了 `estimateObjectBytes`，该操作仍可能阻塞 UI 线程。
- **无容量超限自动清理**: 虽然有 `estimateQuota` 接口，但 `RunStore` 内部没有实现任何 LRU 或基于容量限制的自动驱逐逻辑。Agent 长期运行产生的 `events.jsonl`（记录了所有中间步骤）会无节制地占用用户存储。
- **并发写入冲突**: `saveArtifact` 通过 `IDBKeyRange.bound` 查找 `last.seq`（第 381 行）。在多子代理并发执行并将结果写回同一个 `runId` 的同一 `type` 时，这种非原子的“查询-增加-写入”模式存在严重的 Seq 冲突风险。

### 1.3 导入与导出 (Import & Export)
- **内存峰值风险**: `exportRunAsZip` 虽然尝试通过循环加载附件来减少内存占用（第 147 行），但最终所有数据都会被填充进 `jszip` 实例。对于包含大型 PDF 附件或大量中间结果的 Run，这在移动端或低内存设备上极易触发 OOM。
- **导入覆盖风险**: `importRunFromZip` 默认 `overwrite = true` 会在导入前删除旧运行（第 228 行）。这种破坏性操作缺乏“备份-替换-回滚”机制，一旦 ZIP 文件损坏导致导入失败，原始数据也无法找回。
- **Zip 路径碰撞**: `resolveZipPathForArtifact` 简单地将 `type` 替换为下划线（第 28 行）。如果不同 Artifact 具有相似的 `artifactId` 经过清洗后完全相同，会导致 Zip 内部文件覆盖。

### 1.4 代码鲁棒性 (Robustness)
- **IndexedDB 状态检测不一致**: 多个方法在执行前调用 `this.open()`（第 233, 249, 271 行等）。由于 `_dbp` 是一个 Promise 缓存，如果数据库初次打开由于 IO 错误失败，后续的所有调用都会挂起在这个已失败的 Promise 上。
- **错误的 Fallback 逻辑**: `getArtifact` 在 `type === "events.jsonl"` 时有特殊的合并逻辑（第 443 行）。这种将逻辑硬编码在通用存储层的方法降低了代码的内聚性。

## 2. 改进建议
1. **引入事务封装**: 为涉及多个 Store 的操作（如 `createRun`, `deleteRun`）提供真正的事务支持，确保数据完整性。
2. **异步 ID 生成器**: 放弃依赖查询数据库获取 `nextSeq`，改用带有时间戳和随机因子的 `UUID` 或 `KSUID` 作为 `artifactId`。
3. **流式导出支持**: 在 Node 环境下使用流式 Zip 生成库（如 `archiver`），避免将整个 Zip 包缓存在内存中。
4. **增加配额哨兵**: 在 `saveArtifact` 之前检查 `estimateQuota` 预警，当空间低于 10% 时主动提示用户进行清理。
5. **版本化数据迁移**: 引入类似 `knex` 的 Migration 机制，管理 `AgentRuntimeDB` 的版本变更。
6. **优化 JSONL 处理**: 将 `events.jsonl` 的合并逻辑移动到业务层或专门的 `EventStore` 扩展中，保持 `RunStore` 的原子存储职责。

## cc是如何解决这个问题的

Claude Code (CC) 通过将核心状态持久化在标准的文件系统结构中，并辅以严谨的会话管理机制，解决了 Storage 层面的可靠性问题：

1.  **基于文件系统的原子性存储**:
    *   **目录即会话**: CC 将每个会话 (Session) 和检查点 (Checkpoint) 映射为磁盘上的独立目录和 JSON 文件 ([`src/session/index.ts`](ref/claude-code-open-main/src/session/index.ts))。这种天然的文件系统隔离避免了 IndexedDB 复杂的复合索引带来的性能开销。
    *   **基于 UUID 的隔离**: 所有的会话 ID 和文件哈希均使用 UUID 或加密哈希生成 ([`src/utils/index.ts`](ref/claude-code-open-main/src/utils/index.ts))，彻底解决了 jsagents 在并发写入时的“Seq 冲突风险”。

2.  **强制的存储配额与自动清理 (Housekeeping)**:
    *   **内置容量哨兵**: `enforceStorageLimits` 机制 ([`src/checkpoint/index.ts`](ref/claude-code-open-main/src/checkpoint/index.ts)) 会在每次创建新 Checkpoint 时检查总占用空间。一旦超过 `MAX_STORAGE_SIZE_MB` (500MB)，它会强制执行 LRU 清理策略，优先删除最旧的非基础快照。
    *   **过期回收**: 提供了 `cleanupOldSessions` 逻辑，自动回收超过 30 天的过期会话，解决了 jsagents 中“无节制占用存储”的问题。

3.  **增量存储与内存优化**:
    *   **增量 Diff 算法**: CC 不再全量保存大型文档，而是使用 LCS 算法计算增量 Diff ([`src/checkpoint/index.ts`](ref/claude-code-open-main/src/checkpoint/index.ts))。这不仅显著降低了存储占用，也极大减少了持久化时的序列化开销（解决了 jsagents 中的“大对象序列化阻塞”问题）。
    *   **分片读取**: 加载 Checkpoint 时，CC 只在需要时通过 `reconstructContent` 递归恢复内容，避免了一次性加载所有历史版本到内存。

4.  **跨平台存储适配 (纯浏览器端可用)**:
    *   **存储接口抽象**: CC 的持久化逻辑高度模块化。在浏览器端，可以轻松地将 `fs.writeFileSync` 适配为 `OPFS` (Origin Private File System) 或 `IndexedDB` 的 Blob 存储。
    *   **结构化导出**: 相比于复杂的 Zip 压缩，CC 的 Session 和 Checkpoint 采用标准的 JSONL 或文件夹结构，这使得在浏览器端通过 Web API 进行“流式导出”变得非常简单，无需在内存中构建巨大的压缩包。
