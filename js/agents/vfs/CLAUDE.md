# vfs - 虚拟文件系统

跨平台文件系统抽象（Memory / OPFS / Storage / NodeFs），并提供快照、差量同步与 checkpoint 工具。

## 主要文件

| 文件 | 说明 |
|------|------|
| `vfs.memory.js` | 内存 VFS（测试/临时态） |
| `vfs.opfs.js` | OPFS 后端 |
| `vfs.storage.js` | StorageAdapter 后端 |
| `vfs.node.js` | NodeFs 后端 |
| `vfs-sync-protocol.js` | VFS 快照与增量同步协议 |
| `checkpoints.js` | 快照审计与 artifact 引用 |
| `delta-sync.js` | 文件级 chunk/patch 增量同步 |

## MemoryVfs（最新变更）

`vfs.memory.js` 现支持符号链接语义：

- 新增 `symlink(target, path)`、`readlink(path)`、`lstat(path)`。
- `stat(path)` 会跟随符号链接；`lstat(path)` 返回链接本体信息。
- 内部节点解析支持 `followSymlinks`，并包含 `ELOOP` 防护（最大链深 8）。
- `readdir(..., { withFileTypes: true })` 与 `list()` 现在可返回 `symlink` 类型。
- `unlink(path)` 可删除普通文件与符号链接，目录仍报 `EISDIR`。

## VfsSyncProtocol（新增）

`vfs-sync-protocol.js` 提供主从同步能力：

- `toSnapshot({ prefix })`
  - 基于 `walkFiles()` 导出文件快照
  - 文件内容使用 Base64 编码
  - 返回 `{ files, timestamp, version: '1.0' }`
- `fromSnapshot(snapshot, { clear })`
  - 可选清空现有文件后恢复快照
  - 对单文件写入错误采用 best-effort 跳过
- `applyDelta(delta | delta[])`
  - `content: null` 表示删除
  - `content: string`（Base64）表示写入/更新

事件模型：

- `change`：写入或恢复成功触发（快照恢复附带 `source: 'snapshot'`）。
- `delete`：删除成功触发。

编码兼容：

- Node 侧优先 `Buffer`。
- 浏览器侧使用 `btoa/atob`。

## 使用说明

- `VfsSyncProtocol` 当前未在 `index.js` 聚合导出，需按文件路径显式导入。
- 对外路径继续统一走 `normalizeVfsPath`，避免 `..`、反斜杠和非法根路径输入。
