# Audit History - platform

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] JSDoc 类型/规范
*Archived: 2026-01-19T20:50:12.699Z*

- **File**: `js/agents/runtime/tools/platform/index.js:13`:13
- **Description**: 公开类型定义使用 `any`，且 @param 缺少描述，违反 JSDoc 规范（禁止 any，参数必须带描述）。
- **Suggestion**: 用明确类型或 `unknown` 替代 `any`，补充参数描述，并为 VFS/Logger/emit 建立 @typedef。
```
* @property {any} [vfs] - VFS 实例 (Browser 必需)
```

---

## Archived: 2026-01-19

### [RESOLVED] 错误处理规范
*Archived: 2026-01-19T20:50:08.298Z*

- **File**: `js/agents/runtime/tools/platform/browser.js:89`:89
- **Description**: 多处空 catch 块直接吞掉异常（如目录遍历/文件读取），不记录也不返回错误，容易隐藏权限或 IO 异常。
- **Suggestion**: 至少记录 debug 日志（含当前路径），或将错误累计并在结果中返回。
```
} catch { // 不是目录，跳过 }
```

---

## Archived: 2026-01-19

### [RESOLVED] 模块导入路径
*Archived: 2026-01-19T20:49:58.653Z*

- **File**: `js/agents/runtime/tools/platform/node.js:9`:9
- **Description**: Node 端 exec 依赖路径指向不存在的 `../../exec/index.js`，运行时无法加载执行器。
- **Suggestion**: 修正为 `../../core/exec/index.js`（或调整目录/exports 保证该路径存在）。
```
import { exec as execCommand } from '../../exec/index.js';
```

---

## Archived: 2026-01-19

### [RESOLVED] 工具执行安全
*Archived: 2026-01-19T20:49:54.503Z*

- **File**: `js/agents/runtime/tools/platform/node.js:297`:297
- **Description**: `bash` 将用户提供的 command 直接交给 shell 执行，没有 allowlist/参数校验，若 ToolExecutor 接入不可信输入会导致任意命令执行。
- **Suggestion**: 在 ToolExecutor 层强制参数校验/权限控制；或改为结构化命令+args（避免 shell）；限制允许命令集合和最大超时。
```
const result = await execCommand(process.platform === 'win32' ? 'cmd.exe' : '/bin/sh', process.platform === 'win32' ? ['/c', command] : ['-c', command], { cwd: basePath, timeout });
```

---

## Archived: 2026-01-19

### [RESOLVED] 路径穿越（符号链接绕过）
*Archived: 2026-01-19T20:49:37.638Z*

- **File**: `js/agents/runtime/tools/platform/node.js:43`:43
- **Description**: `isSafePath` 仅用 normalize/relative 校验，未对 basePath 与目标路径做 realpath，符号链接可指向 basePath 外并绕过限制。
- **Suggestion**: 在 read/write/list/glob 前对 basePath 和目标路径使用 `fs.realpath`，并验证目标 realpath 仍在 basePath realpath 前缀内；同时拒绝含 `..` 的路径/模式。
```
const rel = path.relative(normalizedBase, normalized);
```

---

## Archived: 2026-01-19

### [RESOLVED] 路径穿越
*Archived: 2026-01-19T20:49:33.756Z*

- **File**: `js/agents/runtime/tools/platform/browser.js:34`:34
- **Description**: 浏览器端 normalizePath 直接拼接 basePath 与用户输入路径，未清理 '..' 或限制绝对路径，若 VFS 解析上级目录会越权访问 basePath 外的文件。
- **Suggestion**: 对 inputPath 做规范化并拒绝包含 '..' 的路径；禁止绝对路径绕过；使用安全 resolve/realpath 并校验结果仍在 basePath 内。
```
return `${basePath}/${path}`.replace(/\/+/g, '/');
```

---

## Archived: 2026-01-18

### [RESOLVED] path-validation
*Archived: 2026-01-18T20:45:51.530Z*

- **File**: js/agents/runtime/tools/platform/node.js:53:53
- **Description**: glob 只做 resolvePath 未调用 isSafePath；传入绝对路径即可列出 basePath 外文件。
- **Suggestion**: 对 resolved dir 做 isSafePath 校验或拒绝绝对路径；与 read/write/list 同步限制。
```
const dir = resolvePath(searchPath || '.');
```

---

## Archived: 2026-01-18

### [RESOLVED] regex-handling
*Archived: 2026-01-18T20:45:43.399Z*

- **File**: js/agents/runtime/tools/platform/browser.js:112:112
- **Description**: Browser 端 grep 在 try 之外创建 RegExp，非法 pattern 会抛错且不返回 error；同时使用 /g 导致 test() 状态化可能漏检。
- **Suggestion**: 将 RegExp 构造移入 try 并移除 g（或每次 test 前重置 lastIndex），在构造失败时返回 { matches: [], error }。
```
const searchPattern = regex ? new RegExp(pattern, 'gm') : pattern;
```

---

## Archived: 2026-01-18

### [RESOLVED] jsdoc
*Archived: 2026-01-18T20:44:10.302Z*

- **File**: js/agents/runtime/tools/platform/index.js:22:22
- **Description**: PlatformTools.grep 的 JSDoc 未声明 caseSensitive 参数，类型与 Node 实现不一致。
- **Suggestion**: 在 typedef 中补充 caseSensitive?: boolean，并说明 Browser 端忽略该参数。
```
@property {(args: { pattern: string, path?: string, regex?: boolean }) => Promise<{ matches: any[], error?: string }>} grep
```

---

## Archived: 2026-01-18

### [RESOLVED] path-validation
*Archived: 2026-01-18T20:43:38.873Z*

- **File**: js/agents/runtime/tools/platform/node.js:113:113
- **Description**: grep 只做 resolvePath 未调用 isSafePath；传入绝对路径可读取 basePath 外内容。
- **Suggestion**: 对 resolved dir 做 isSafePath 校验或拒绝绝对路径；与 read/write/list 同步限制。
```
const dir = resolvePath(searchPath || '.');
```

---

## Archived: 2026-01-18

### [RESOLVED] path-traversal
*Archived: 2026-01-18T20:42:24.458Z*

- **File**: js/agents/runtime/tools/platform/node.js:46:46
- **Description**: isSafePath 仅用 startsWith(basePath) 判断，basePath 前缀路径（如 /app-escape）可绕过限制，read/write/list 可能访问 basePath 外目录。
- **Suggestion**: 使用 path.relative(...) 校验边界（relative 不以 '..' 开头且非绝对路径），并考虑 realpath 以防符号链接逃逸。
```
return normalized.startsWith(path.normalize(basePath));
```

---

