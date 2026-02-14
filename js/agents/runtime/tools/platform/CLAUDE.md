# platform - 跨平台工具适配器

根据运行环境自动选择正确的工具实现，提供统一的工具接口（handler 返回 `{ ..., error?: string }`）。

- Browser: VFS（可运行在 Pyodide/QuickJS 等沙箱环境），不支持 `bash`
- Node-like: `fs` + `child_process`（`bash` 受 allowlist 与超时限制）

## 能力矩阵

| Tool | Browser | Node-like |
|------|---------|-----------|
| `glob` | `VFS.glob` / 内存遍历 | `fast-glob` / `fs.readdir` |
| `grep` | 内存搜索（支持 `regex`） | `ripgrep` / 手动搜索（支持 `regex` + `caseSensitive`） |
| `read` | `VFS.readText` / `VFS.read` | `fs.readFile` |
| `write` | `VFS.writeText` / `VFS.write` | `fs.writeFile` |
| `list` | `VFS.list` | `fs.readdir` |
| `bash` | ❌ `null` | `child_process`（受 allowlist 与超时限制） |

## 使用

```javascript
import { createPlatformTools, hasCapability } from 'js/agents/runtime/tools/platform';

const tools = await createPlatformTools({
  vfs,                          // Browser: 必需
  basePath: 'workspace',        // 可选：工作目录前缀
  logger,                       // 可选：{ debug, warn }
  emit: (name, payload) => logger?.debug?.(name, payload),
  allowedCommands: ['npm'],     // Node only：建议最小化白名单
  maxTimeoutMs: 30000           // Node only：bash 最大超时（ms）
});

const { files } = await tools.glob({ pattern: '**/*.js', path: 'src' });
const { matches } = await tools.grep({ pattern: 'TODO', path: 'src', regex: false });
const { content } = await tools.read({ path: 'package.json', startLine: 1, endLine: 120 });
await tools.write({ path: 'notes.md', content: '# Notes\\n' });
const { entries } = await tools.list({ path: 'src' });

if (hasCapability('bash') && tools.bash) {
  const { stdout, exitCode } = await tools.bash({ command: 'npm test', timeout: 10000 });
}
```

## 路径约束（Browser 端）

`path` 会被规范化后再交给 VFS：

- 反斜杠 `\\` 会被转换为 `/`
- 多余的 `/` 会被折叠，`.` 段会被移除
- 空值会被视为 `.`

强制拒绝：

- `path` 以 `/` 开头（绝对路径）
- `path` 任意段为 `..`（路径穿越）

`basePath` 由宿主传入：实现会做基础规范化（反斜杠归一化、去掉末尾 `/`）。但 `basePath` 仍应视为可信配置而非用户输入。

建议：

- 不要将用户输入直接作为 `basePath`
- 宿主侧额外拒绝绝对路径与 `..` 段
- 多租户场景中为每个会话固定根前缀目录

## 参数与错误约定

- 工具入参应为 plain object，参数错误返回 `{ error }`
- Browser 端 `bash` 恒为 `null`
- Node 端 `bash` 同时受 `allowedCommands` 与 `timeout` 限制
- 业务层建议统一消费 `{ error }`，避免直接暴露底层异常细节

## 与 ToolExecutor 集成

```javascript
import { ToolExecutor } from 'js/agents/runtime/tools';
import { createPlatformTools } from 'js/agents/runtime/tools/platform';

const platformTools = await createPlatformTools({
  vfs,
  basePath: 'workspace',
  allowedCommands: ['node', 'npm'],
  maxTimeoutMs: 30000
});

const executor = new ToolExecutor({
  tools: platformTools,
  logger
});
```
