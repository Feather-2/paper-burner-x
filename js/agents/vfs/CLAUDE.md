# vfs - 虚拟文件系统

跨平台文件系统抽象，支持内存、OPFS 和 Storage API。
在基础读写之上，还提供（可选的）文本 diff、checkpoint 快照、以及 delta-sync 增量同步工具。

## 实现

| 文件 | 说明 |
|------|------|
| `index.node.js` | Node.js 入口 (含 NodeFsVfs) |
| `index.browser.js` | 浏览器入口 (OPFS/Storage/Memory) |
| `index.js` | 默认入口 (跨端转发) |
| `vfs.node.js` | NodeFsVfs (Node.js `fs`) |
| `vfs.memory.js` | MemoryVfs (测试/临时存储) |
| `vfs.opfs.js` | OpfsVfs (浏览器 OPFS) |
| `vfs.storage.js` | StorageVfs (StorageAdapter / localStorage 等) |
| `path.js` | VFS 路径规范化与校验 (`normalizeVfsPath`) |
| `diff.js` | 文本 diff 与 unified diff 生成 |
| `checkpoints.js` | VFS Checkpoint：快照、预览、摘要与 artifact 引用 |
| `delta-sync.js` | 增量同步：chunk/rolling hash/patch |

## 条件导出

package.json 配置了条件导出，构建工具自动选择正确入口：

| 环境 | 入口文件 |
|------|----------|
| Node.js | `index.node.js` |
| Browser | `index.browser.js` |
| Default | `index.js` |

```javascript
// 使用 package.json exports
import { createVfs } from 'paper-burner-root/agents/vfs';
```

## 接口

```javascript
interface Vfs {
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, data: Uint8Array): Promise<void>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(dir: string): Promise<string[]>;
  mkdir(dir: string): Promise<void>;
}
```

## 使用示例

```javascript
import { createVfs, MemoryVfs, OpfsVfs } from 'js/agents/vfs';

// 自动选择最佳实现
const vfs = await createVfs();

// 或指定实现
const memVfs = new MemoryVfs();
const opfsVfs = await OpfsVfs.create();

// 操作文件
await vfs.write('/data/config.json', new TextEncoder().encode(json));
const data = await vfs.read('/data/config.json');
```

## 路径安全

- 所有对外暴露的 path 必须先经过 `normalizeVfsPath`，拒绝 `..`、反斜杠、空路径等非法形式。
- 不要把用户传入的 path 直接拼接到底层 key/handle（尤其是 Storage/IndexedDB key、OPFS 目录句柄名）。

## Checkpoint / Diff

`checkpoints.js` 用于把一次 VFS 读写的“前/后”状态结构化记录下来（用于审计、回放、调试或对外展示）。
常见信息包括：bytes、sha256、preview/text/base64（小内容内联）、payload 引用（大内容外置）、以及 unified diff（纯文本）。

artifact 约定：
- 本地 artifact key 使用固定前缀（例如 `pb_vfs_artifact|`）做命名空间隔离，避免与业务 key 冲突。
- 大 payload 建议使用 RunStore/Artifact Store 保存，并在 checkpoint 中只存引用（`artifactId`、`bytes`、`sha256`、`encoding`）。

安全约定：
- diff/preview/text/base64 必须作为纯文本渲染（`textContent`），不要拼接到 `innerHTML`。
- 不要在日志里输出完整 `text/base64`（可能含敏感信息）；只输出 bytes/sha256/前 N 字符摘要。

兼容性约定：
- Node 环境可用 `globalThis.Buffer` 做编码/解码；浏览器端必须提供无 Buffer 的实现，并在使用前显式检测（Buffer 不存在时不要访问其方法）。

## Delta Sync（增量同步）

`delta-sync.js` 提供基于 chunk 的增量同步能力，用于减少传输与写入量。
- 默认 chunk size 为 64KiB（应集中在 `DEFAULT_CHUNK_SIZE` 常量/配置项中管理）
- 用哈希做变更检测与冲突识别时，需明确哈希算法与输出格式（推荐 SHA-256 + hex，小写固定长度）

安全约定：
- 不要把弱哈希（如 FNV-1a）用于冲突判定或完整性校验；只能用于启发式/非安全场景，并且最终仍需用 SHA-256 校验。

## 测试要点

- 各后端一致性：Memory/OPFS/Storage 在 `read/write/exists/list/mkdir/delete` 的边界行为一致
- 并发读写：同一路径并发写入/读取的冲突与可见性
- 边界路径：`/`、重复斜杠、超长路径、Unicode、`.`/`..` 等
- 原子写入：避免半写入（尤其是 OPFS/Storage 后端）
- 配额管理：存储满额时的可恢复错误与优雅降级
