# platform - 跨平台工具适配器

根据运行环境自动选择正确的工具实现，提供统一的工具接口（handler 返回 `{ ..., error?: string }`）。

- Browser: VFS（可运行在 Pyodide/QuickJS 等沙箱环境中），不支持 bash
- Node-like: fs + child_process（bash 受 allowlist 与超时限制）

## 能力矩阵

| Tool | Browser | Node-like |
|------|---------|-----------|
| `glob` | VFS.glob / 内存遍历 | fast-glob / fs.readdir |
| `grep` | 内存搜索（可选 `regex`） | ripgrep / 手动搜索（`caseSensitive` 支持） |
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
const { matches } = await tools.grep({ pattern: 'TODO', path: 'src/', regex: false });
const { content } = await tools.read({ path: 'package.json', startLine: 1, endLine: 200 });
await tools.write({ path: 'notes.md', content: '# Notes\\n' });
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

`path` 会被规范化后再交给 VFS：

- 反斜杠 `\` 会被转换为 `/`
- 多余的 `/` 会被折叠，`.` 段会被移除
- 空值会被视为 `.`

强制拒绝：

- `path` 以 `/` 开头（绝对路径）
- `path` 任何段为 `..`（路径穿越）

`basePath` 由宿主传入：实现会做基础规范化（反斜杠归一化、去掉末尾 `/`），但仍建议：

- 不要来自不可信输入
- 避免 `..` 段与绝对路径；需要更强隔离时，在宿主侧做校验/固定工作目录

## 与 ToolExecutor 集成

```javascript
import { ToolExecutor } from 'js/agents/runtime/tools';
import { createPlatformTools } from 'js/agents/runtime/tools/platform';

const platformTools = await createPlatformTools({ vfs, basePath });

const executor = new ToolExecutor({
  tools: {
    glob: {
      handler: platformTools.glob,
      parameters: {
        pattern: { type: 'string', required: true, description: 'Glob pattern' },
        path: { type: 'string', required: false, description: 'Search base path' },
      },
    },
    grep: {
      handler: platformTools.grep,
      parameters: {
        pattern: { type: 'string', required: true, description: 'Search pattern' },
        path: { type: 'string', required: false, description: 'Search base path' },
        regex: { type: 'boolean', required: false, description: 'Treat pattern as RegExp source' },
        caseSensitive: { type: 'boolean', required: false, description: 'Node only' },
      },
    },
    read: {
      handler: platformTools.read,
      parameters: {
        path: { type: 'string', required: true, description: 'File path' },
        startLine: { type: 'number', required: false, description: '1-based start line' },
        endLine: { type: 'number', required: false, description: '1-based end line' },
      },
    },
    write: {
      handler: platformTools.write,
      parameters: {
        path: { type: 'string', required: true, description: 'File path' },
        content: { type: 'string', required: true, description: 'File content' },
      },
    },
    list: {
      handler: platformTools.list,
      parameters: {
        path: { type: 'string', required: true, description: 'Directory path' },
      },
    },
    ...(platformTools.bash
      ? {
          bash: {
            handler: platformTools.bash,
            parameters: {
              command: { type: 'string', required: true, description: 'Command to run (allowlist enforced)' },
              timeout: { type: 'number', required: false, description: 'Timeout in ms' },
            },
          },
        }
      : {}),
  },
});
```
