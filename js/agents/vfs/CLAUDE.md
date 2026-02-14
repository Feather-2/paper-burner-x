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
| `checkpoints.js` | VFS Checkpoint：快照、预览、摘要、artifact 引用；支持 `StorageAdapterLike` 与 `RunStoreLike`；使用安全时间戳 ID |
| `delta-sync.js` | 增量同步：chunk/rolling hash/patch；默认 SHA-256，异常时降级 FNV-1a（兼容模式） |

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

## 路径与对象安全

- 所有对外暴露的 path 必须先经过 `normalizeVfsPath`，拒绝 `..`、反斜杠、空路径等非法形式。
- 不要把用户传入的 path 直接拼接到底层 key/handle（尤其是 Storage/IndexedDB key、OPFS 目录句柄名）。
- checkpoint 配置/元数据应使用 plain object（配合 `isPlainObject`）校验，避免异常原型链对象进入持久化层。

## Checkpoint / Diff / Artifact

`checkpoints.js` 用于把一次 VFS 读写的“前/后”状态结构化记录下来（用于审计、回放、调试或对外展示）。

常见信息包括：`bytes`、`sha256`、`preview/text/base64`（小内容内联）、`payload` 引用（大内容外置）、以及 unified diff（纯文本）。

数据模型要点：
- `VfsCheckpointSide`：单侧快照（支持 `preview/text/base64/truncated/payload`）。
- `VfsPayloadRef`：外置 payload 引用（`artifactId/type/encoding/bytes/sha256`）。
- `RunStoreLike`：可选运行态 artifact 存储（`saveArtifact/listArtifacts/...`）。

artifact 约定：
- 本地 artifact key 使用固定前缀（例如 `pb_vfs_artifact|`）做命名空间隔离，避免与业务 key 冲突。
- 建议使用安全时间戳 ID（如 `makeSecureTimestampedId`）生成 checkpoint/artifact 标识，降低碰撞与可预测性风险。

## Delta Sync 说明

`delta-sync.js` 提供文件级增量同步能力：chunk 切分、哈希比对、补丁应用、冲突检测与断点续传。

- 默认哈希：Web Crypto `SHA-256`。
- 兼容降级：当 `crypto.subtle` 不可用时，降级到 FNV-1a（仅兼容用途，不应作为强完整性保证）。
- 默认 chunk 大小：`64 * 1024`（64KB）。

## 测试重点

- 各后端一致性测试：Memory / OPFS / Storage 的读写、list、exists 语义一致。
- 并发读写测试：高并发写入同一路径时确保原子性与最终一致。
- 边界路径测试：空路径、`..`、反斜杠、超长路径、深层目录。
- 配额与降级测试：Storage/OPFS 空间不足时错误可恢复、提示友好、行为可预期。