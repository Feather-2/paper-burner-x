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

## Checkpoint / Diff

`checkpoints.js` 用于把一次 VFS 读写的“前/后”状态结构化记录下来（用于审计、回放、调试或对外展示）。
常见信息包括：bytes、sha256、preview/text/base64（小内容内联）、payload 引用（大内容外置）、以及 unified diff（纯文本）。

安全约定：
- diff/preview 必须作为纯文本渲染（`textContent`），不要拼接到 `innerHTML`。

## Delta Sync（增量同步）

`delta-sync.js` 提供基于 chunk 的增量同步能力，用于减少传输与写入量。
- 默认 chunk size 为 64KiB（建议作为常量/配置项统一管理）
- 用哈希做变更检测与冲突识别时，需明确哈希算法与输出格式（避免弱哈希降级导致的碰撞风险）

## 目录约定（高优先级）

- 路径安全：所有外部输入的 `path` 必须先 `normalizeVfsPath`，并拒绝 `..`、反斜杠、空路径等非法形式。
- 原子操作：需要“写入要么成功要么不产生半成品”的场景，优先用临时对象/两阶段提交实现。
- 配额管理：Storage/OPFS 可能抛 `QuotaExceededError`（或类似错误），调用方需捕获并优雅降级（例如回退到 MemoryVfs）。

## 平台检测

跨端 `createVfs()` 的运行时判断由统一的 `shared/platform.js` 提供：
- `index.js` 基于 `Platform.isNode` 分发到 `index.browser.js` / `index.node.js`
- Browser：优先 OPFS，失败时降级到 Storage/Memory
- Node.js：默认 MemoryVfs，可通过 `kind: 'nodefs'` 使用 NodeFsVfs
