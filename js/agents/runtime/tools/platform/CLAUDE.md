# platform - 跨平台工具适配器

根据运行环境自动选择正确的工具实现，提供统一的工具接口（handler 返回 `{ ..., error?: string }`）。

## 能力矩阵

| Tool | Browser | Node-like |
|------|---------|-----------|
| `glob` | VFS.glob / 内存遍历 | fast-glob / fs.readdir |
| `grep` | 内存搜索 | ripgrep / 手动搜索（`caseSensitive` 支持） |
| `read` | VFS.readText / VFS.read | fs.readFile |
| `write` | VFS.writeText / VFS.write | fs.writeFile |
| `list` | VFS.list | fs.readdir |
| `bash` | ❌ null | child_process（受 allowlist 与超时限制） |

## 使用

```javascript
import { createPlatformTools, hasCapability } from 'js/agents/runtime/tools/platform';

const tools = await createPlatformTools({
  vfs,        // Browser: 必需
  basePath,   // 工作目录前缀（可选）
  logger,     // 可选：{ debug, warn }
  emit: (name, payload) => logger?.debug?.(name, payload), // 可选：事件回调
  allowedCommands: ['npm', 'node'], // Node only：bash 命令白名单（建议最小化）
  maxTimeoutMs: 30000,             // Node only：bash 最大超时（ms）
});

// 文件操作
const { files } = await tools.glob({ pattern: '**/*.js' });
const { matches } = await tools.grep({ pattern: 'TODO', path: 'src/' });
const { content } = await tools.read({ path: 'package.json', startLine: 1, endLine: 200 });
await tools.write({ path: 'notes.md', content: '# Notes\n' });
const { entries } = await tools.list({ path: 'src/' });

// 命令执行 (仅 Node)
if (tools.bash) {
  const { stdout, exitCode } = await tools.bash({ command: 'npm test', timeout: 10000 });
}

// 能力检测
if (hasCapability('bash')) {
  // Node 端才有
}
```

### 路径约束（Browser 端）

- `path` 不允许以 `/` 开头（拒绝绝对路径）。
- `path` 中不允许出现 `..` 段（拒绝路径穿越）。
- `basePath` 由宿主传入，建议不要来自不可信输入，并避免 `..`/绝对路径。

## 与 ToolExecutor 集成

```javascript
import { ToolExecutor } from 'js/agents/runtime/tools';
import { createPlatformTools } from 'js/agents/runtime/tools/platform';

const platformTools = await createPlatformTools({ vfs, basePath });

const executor = new ToolExecutor({
  tools: {
    glob: {
      handler: platformTools.glob,
      parameters: { pattern: { type: 'string', required: true }, path: { type: 'string' } },
    },
    grep: {
      handler: platformTools.grep,
      parameters: {
        pattern: { type: 'string', required: true },
        path: { type: 'string' },
        regex: { type: 'boolean' },
        caseSensitive: { type: 'boolean' }, // Node only
      },
    },
    read_file: {
      handler: platformTools.read,
      parameters: {
        path: { type: 'string', required: true },
        startLine: { type: 'number' },
        endLine: { type: 'number' },
      },
    },
    write_file: {
      handler: platformTools.write,
      parameters: {
        path: { type: 'string', required: true },
        content: { type: 'string', required: true },
      },
    },
    list_dir: {
      handler: platformTools.list,
      parameters: { path: { type: 'string', required: true } },
    },
    bash: platformTools.bash
      ? { handler: platformTools.bash, parameters: { command: { type: 'string', required: true }, timeout: { type: 'number' } } }
      : undefined,
  },
});
```
