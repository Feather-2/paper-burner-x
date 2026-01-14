# vfs - 虚拟文件系统

跨平台文件系统抽象，支持内存、OPFS 和 Storage API。

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

## 平台检测

跨端 `createVfs()` 的运行时判断由统一的 `shared/platform.js` 提供：
- `index.js` 基于 `Platform.isNode` 分发到 `index.browser.js` / `index.node.js`
- Browser：优先 OPFS，失败时降级到 Storage/Memory
- Node.js：默认 MemoryVfs，可通过 `kind: 'nodefs'` 使用 NodeFsVfs
