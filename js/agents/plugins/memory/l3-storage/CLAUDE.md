# l3-storage - L3 索引与持久化

L3Storage 的索引、持久化、去重与跨标签页协调工具。供 `js/agents/plugins/memory/l3-storage.js` 组合使用。

## 核心文件

| 文件 | 职责 |
|------|------|
| `constants.js` | 默认容量阈值与字节估算常量 |
| `hash.js` | cyrb53 哈希与内容去重哈希计算 |
| `index-manager.js` | index state 创建/序列化/恢复、时间线与索引维护 |
| `query.js` | 时间线查询、关键词检索、去重判断 |
| `storage-io.js` | VFS 读写、index 持久化、临时文件恢复 |
| `tab-coordinator.js` | 跨标签页 LRU 协调 hooks 与 session 编解码 |
| `utils.js` | 关键词规范化、摘要截断、runId 校验、错误判断 |

## 索引结构

- `timeline` - [{ id, ts, accessedAt, summary, stageKey, superseded, supersededBy }]
- `keywords` - Map<string, Set<snapshotId>>
- `stages` - Map<string, snapshotId>
- `hashIndex` - Map<contentHash, snapshotId>

`serializeIndexState` 将 Map 转换为数组以写入 JSON，`restoreIndexState` 负责恢复并过滤非法项。

## 存储布局

```
.agents/runs/<runId>/l3/
  snapshots/<id>.json
  checkpoints/<id>.json
  index.json
  index.json.tmp
```

`createStorageIO` 使用临时文件 + rename(若支持)进行原子写入，`recoverTempIndexFile` 用于崩溃恢复。

## 关键词与摘要

- `normalizeKeywords` 统一为小写并去重。
- `getSummary` 优先使用 `data.summary`，否则 JSON.stringify 并截断至 200 字符。
- `computeContentHash` 使用 cyrb53（非加密）用于去重。

## 跨标签页协调

`encodeTabCoordinatorSession`/`decodeTabCoordinatorSession` 将 `{ runId, snapshotId }` 编码为 JSON 字符串，`ensureTabCoordinatorHooks` 注入 eviction/access hook 用于同步 LRU。

## 使用约定

- `runId` 必须通过 `validateRunId` 校验，避免路径穿越。
- `snapshotId`/`checkpointId` 应为安全文件名片段（推荐 `snap_...` / `ckpt_...`）。