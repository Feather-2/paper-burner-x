# vfs - 虚拟文件系统

跨平台文件系统抽象，支持内存、OPFS 和 Storage API。

## 实现

| 文件 | 职责 | 适用场景 |
|------|------|----------|
| `memory-vfs.js` | MemoryVfs | 测试/临时存储 |
| `opfs-vfs.js` | OpfsVfs | 浏览器 (Origin Private File System) |
| `storage-vfs.js` | StorageVfs | localStorage/sessionStorage |

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

`createVfs()` 自动检测：
- 浏览器 + OPFS 支持 → OpfsVfs
- 浏览器 + 无 OPFS → StorageVfs
- 其他环境 → MemoryVfs
