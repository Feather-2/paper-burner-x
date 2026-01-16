# platform - 跨平台工具适配器

根据运行环境自动选择正确的工具实现。

## 能力矩阵

| Tool | Browser | Node-like |
|------|---------|-----------|
| `glob` | VFS.glob / 内存遍历 | fast-glob / fs.readdir |
| `grep` | 内存搜索 | ripgrep / 手动搜索 |
| `read` | VFS.readText | fs.readFile |
| `write` | VFS.writeText | fs.writeFile |
| `list` | VFS.list | fs.readdir |
| `bash` | ❌ null | child_process |

## 使用

```javascript
import { createPlatformTools, hasCapability } from 'js/agents/runtime/tools/platform';

// 自动选择平台适配器
const tools = await createPlatformTools({
  vfs,        // Browser: 必需
  basePath,   // 工作目录
});

// 文件操作
const { files } = await tools.glob({ pattern: '**/*.js' });
const { matches } = await tools.grep({ pattern: 'TODO', path: 'src/' });
const { content } = await tools.read({ path: 'package.json' });
await tools.write({ path: 'notes.md', content: '# Notes' });
const { entries } = await tools.list({ path: 'src/' });

// 命令执行 (仅 Node)
if (tools.bash) {
  const { stdout, exitCode } = await tools.bash({ command: 'npm test' });
}

// 能力检测
if (hasCapability('bash')) {
  // Node 端才有
}
```

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
      parameters: { pattern: { type: 'string', required: true }, path: { type: 'string' } },
    },
    read_file: {
      handler: platformTools.read,
      parameters: { path: { type: 'string', required: true } },
    },
    write_file: {
      handler: platformTools.write,
      parameters: { path: { type: 'string', required: true }, content: { type: 'string', required: true } },
    },
    list_dir: {
      handler: platformTools.list,
      parameters: { path: { type: 'string', required: true } },
    },
    ...(platformTools.bash ? {
      bash: {
        handler: platformTools.bash,
        parameters: { command: { type: 'string', required: true } },
      },
    } : {}),
  },
});
```

## 安全

### Node 端

- 路径遍历保护：所有路径解析限制在 `basePath` 内
- 命令超时：默认 60s，可配置
- 输出限制：grep/glob 结果数量限制

### Browser 端

- VFS 隔离：只能访问 VFS 内文件
- 无命令执行：`bash` 为 null

## 文件

| 文件 | 职责 |
|------|------|
| `index.js` | createPlatformTools, hasCapability |
| `browser.js` | VFS 适配器 |
| `node.js` | fs + exec 适配器 |
