# Audit History - safety

Archived issues from security audits.

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

