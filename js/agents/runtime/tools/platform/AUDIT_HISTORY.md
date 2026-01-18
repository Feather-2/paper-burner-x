# Audit History - platform

Archived issues from security audits.

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

