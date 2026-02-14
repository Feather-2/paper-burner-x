# l3-storage - L3 索引与持久化

L3Storage 的索引、持久化、去重与跨标签页协调工具。供 `js/agents/plugins/memory/l3-storage.js` 组合使用。

## 核心文件

| 文件 | 职责 |
|------|------|
| `constants.js` | 默认容量阈值与字节估算常量（snapshot 数量/总字节上限、摘要字节估算、条目开销估算） |
| `hash.js` | cyrb53 哈希与内容去重哈希计算（非加密；输出 hex 字符串） |
| `index-manager.js` | index state 创建/序列化/恢复、时间线与索引维护（含 checkpointIndex 兼容） |
| `query.js` | 时间线查询、关键词检索、去重判断 |
| `storage-io.js` | VFS 读写、index 持久化、临时文件恢复 |
| `tab-coordinator.js` | 跨标签页 LRU 协调 hooks 与 session 编解码 |
| `utils.js` | 关键词规范化、摘要截断、runId 校验、错误判断 |

## 索引结构

- `timeline` - `[{ id, ts, accessedAt, summary, stageKey, superseded, supersededBy }]`
- `keywords` - `Map<string, Set<snapshotId>>`
- `stages` - `Map<string, snapshotId>`
- `hashIndex` - `Map<contentHash, snapshotId>`

`serializeIndexState` 将 Map 转换为数组以写入 JSON，`restoreIndexState` 负责恢复 Map 结构并对非法容器做兜底处理。

## 序列化载荷

`index.json` 的顶层载荷包含元信息与索引内容：

- `schemaVersion` - 当前为 `0.1`（用于将来迁移）
- `runId` - 当前 run 标识（用于元数据校验/调试）
- `updatedAt` - `Date.now()` 时间戳
- `checkpointIndex` - 有序 checkpoint id 列表（兼容旧字段 `checkpoints`）

注意：`checkpointIndex` 不属于 index state 本体（timeline/keywords/stages/hashIndex），但与 index 一起持久化以支持恢复。

## 存储布局

```text
.agents/runs/<runId>/l3/
  snapshots/<id>.json
  checkpoints/<id>.json
  index.json
  index.json.tmp
```

`createStorageIO` 使用临时文件 + rename（若支持）进行原子写入，`recoverTempIndexFile` 用于崩溃恢复。

## 容量估算与逐出

- `DEFAULT_MAX_SNAPSHOTS` 默认 `1000`，控制 snapshot 数量上限（逐出触发条件之一）。
- `DEFAULT_MAX_STORAGE_BYTES` 默认 `100MB`，控制估算的总存储上限。
- `BYTES_PER_CHAR` 默认 `2`，用于摘要等字符串的粗略字节估算（当前按 UTF-8 平均字节近似）。
- `ENTRY_OVERHEAD_BYTES` 默认 `200`，用于每条 timeline/snapshot 元数据的固定开销估算。

这些估算用于降低频繁读取真实文件大小的成本，因此是“近似值”，应配合实际逐出策略使用。

## 关键词、摘要与去重

- `normalizeKeywords` 统一为小写并去重。
- `getSummary` 优先使用 `data.summary`，否则 `JSON.stringify` 并截断至 200 字符。
- `computeContentHash` 使用 cyrb53（非加密）用于去重；非字符串输入会先尝试 `JSON.stringify`，不可序列化时回退到 `String(data ?? "")`。

说明：`computeContentHash` 对超大对象会有序列化成本，建议上游在写入前做尺寸限制或摘要化处理。

## 跨标签页协调

`encodeTabCoordinatorSession`/`decodeTabCoordinatorSession` 将 `{ runId, snapshotId }` 编码为 JSON 字符串，`ensureTabCoordinatorHooks` 负责：

- 注入 `beforeEvict` 钩子，优先跳过当前标签页活跃 session 对应 snapshot；
- 注入 `onAccess` 钩子，在访问命中时刷新跨标签页 session；
- 在无协调器时返回 no-op hooks，保证主流程可用。

## 恢复与输入约束

`restoreIndexState` 当前负责结构恢复（timeline/Map 容器转换与基础兜底），但不对每条 `timeline` 记录做强字段校验或硬裁剪。建议上游确保：

- 载荷来源可信或已完成校验；
- `timeline` 条目数量与字符串字段长度受控；
- 异常/超大数据在进入 L3 前被拦截。