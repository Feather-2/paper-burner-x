# Audit History - safety

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] JSDoc 使用 any
*Archived: 2026-01-19T23:40:38.816Z*

- **File**: js/agents/runtime/safety/tool-permissions.js:215
- **Description**: ToolPermissions 中多处 JSDoc 使用 {any}，违反“禁止 any 类型”的项目约定，降低类型清晰度与可维护性。
- **Suggestion**: 将 {any} 替换为更具体的类型（如 `string | null | undefined`、`PermissionLevel | string | null`、`Record<string, unknown>`），并在其他同类位置同步修正。
```
* @param {any} level
```

---

## Archived: 2026-01-19

### [RESOLVED] 命令替换绕过
*Archived: 2026-01-19T23:40:19.762Z*

- **File**: js/agents/runtime/safety/tool-restrictions.js:145
- **Description**: evaluateToolRestrictions 仅依赖 parseCompoundCommand + 字符串匹配，未检测 $() / 反引号 / <() 等命令替换。在 allowlist 场景下，`ls $(rm -rf /)` 会被当作允许命令通过，从而绕过 blockedCommands 并在子 shell 执行高危命令。
- **Suggestion**: 在 evaluateToolRestrictions 中先检测命令替换（复用 command-classifier 的 hasCommandSubstitution），发现即拒绝；或在 ToolPermissions.check 对 bash 工具前置调用 classifyCommand/hasCommandSubstitution，避免 allowlist 被绕过。
```
const parsed = parseCompoundCommand(command);
...
const cmd = argv.join(" ");
```

---

## Archived: 2026-01-18

### [RESOLVED] quality
*Archived: 2026-01-18T20:45:04.019Z*

- **File**: js/agents/runtime/safety/command-classifier.js:142
- **Description**: fork bomb 检测的 bash -c 正则回溯引用错误，`(.*)\1` 回溯到捕获组而非引号，导致漏报。
- **Suggestion**: 改为 `/(['"])(.*?)\1/` 形式匹配成对引号，并添加对应测试用例。
```
if (/bash\\s+-c\\s*['"](.*)\\1['"]\\s*&/.test(raw)) return true;
```

---

## Archived: 2026-01-18

### [RESOLVED] security
*Archived: 2026-01-18T20:44:50.203Z*

- **File**: js/agents/runtime/safety/command-classifier.js:163
- **Description**: tokenizeShell/parseCompoundCommand 未识别 `$()`、反引号或进程替换等命令替换，allow/block 规则可被子命令绕过。
- **Suggestion**: 在评估前检测 `$(`、反引号、`<(`、`>(` 等并直接标记为危险/拒绝，或改用成熟 shell 解析器并展开子命令后再匹配。
```
/**
 * Minimal shell tokenizer (quotes + backslash escapes).
 * Conservative: does not aim to fully parse POSIX shell.
 */
function tokenizeShell(input) {
```

---

## Archived: 2026-01-18

### [RESOLVED] security
*Archived: 2026-01-18T20:42:18.323Z*

- **File**: js/agents/runtime/safety/tool-restrictions.js:23
- **Description**: normalizeList 使用 /[,\\n]/ 分割字符串，实际按逗号、反斜杠或字符 n 分割，无法按换行分割，可能导致 allow/block 列表解析错误，从而放松限制。
- **Suggestion**: 改为 `/[,\n]/` 或 `split(/,|\n/)`，并补充字符串配置的单元测试。
```
return raw
  .split(/[,\\n]/)
  .map((v) => v.trim())
```

---

