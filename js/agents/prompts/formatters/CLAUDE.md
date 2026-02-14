# formatters - 提示词格式化器

## 模块描述
为 prompt-template 的 `{{var|formatter}}` 渲染管道提供内置格式化器。格式化器负责把变量值转换为更适合 prompt 的文本，并配合 `escapeTemplateDelimiters` 在插值输出中转义 `{{`/`}}`，避免用户内容注入新的模板占位符。

## 核心文件

| 文件 | 作用 |
|------|------|
| `index.js` | 导出格式化器并定义 `DEFAULT_FORMATTERS` 映射 |
| `escape-template-delimiters.js` | 将输出中的 `{{`/`}}` 转义为 `\\{\\{`/`\\}\\}`，防止二次模板解析 |
| `format-bullets.js` | 列表/多行文本转为 Markdown bullet（支持 `bullet`/`indent`；忽略空行/空项） |
| `format-code-block.js` | 生成 fenced code block（支持 `lang`；`lang` 会 `trim()`） |
| `format-json.js` | JSON 美化输出（`space` 缩进；可选 `onError` 回调；对 `space` 做数值归一化） |
| `format-lines.js` | 数组/字符串转行文本 |
| `format-trim.js` | 去除首尾空白 |
| `format-upper.js` | 转大写 |

## 关键概念

- **格式化器签名**：`(value, options?) => string`，`options` 为可选配置对象（通常由模板调用参数解析而来）。
- **空值策略**：多数 formatter 将 `null`/`undefined` 视为“无内容”，直接返回空字符串 `""`。
- **格式化管道**：占位符可串联多个 formatter，顺序执行（如 `json` → `code`）。
- **默认表**：`DEFAULT_FORMATTERS` 提供 `bullets`/`code`/`json`/`lines`/`trim`/`upper`。
- **安全转义**：`escapeTemplateDelimiters` 使用反斜杠转义把 `{{`/`}}` 变为 `\\{\\{`/`\\}\\}`，避免文本处理链路中的 Unicode 归一化导致绕过。

## 常见任务

- 在模板中使用内置 formatter

```markdown
待办：
{{items|bullets}}

配置：
{{config|json(2)}}

代码：
{{snippet|code(js)}}
```

- 内置 formatter 的 options 约定（用于实现/测试；`name(...)` 如何映射为 options 由上层渲染器决定）
  - `bullets`: `{ bullet, indent }`
    - 数组：`null`/空白项会被过滤
    - 字符串：按换行拆分；空行会被过滤；每行会 `trimEnd()`
  - `code`: `{ lang }`（`lang` 会被 `trim()`；不会自动过滤换行/反引号等特殊字符）
  - `json`: `{ space, onError? }`
    - `space` 会被归一化为 `>= 0` 的整数
    - `JSON.stringify` 按规范会将缩进宽度上限处理为 10；仍建议上层限制合理区间（如 0-10）
    - `onError` 通常仅用于运行时注入/调用

- 新增 formatter：新增 `format-xxx.js` 并导出函数（建议采用 `(value, options)` 签名），然后在 `index.js` 中导出并加入 `DEFAULT_FORMATTERS`。

- 运行时注入自定义 formatter

```javascript
renderPromptTemplate(tpl, {
  vars,
  formatters: { slug: (v) => String(v ?? "").toLowerCase() },
});
```

## 安全提示

- `code` formatter 仅负责包裹 fenced code block；如果输入可能包含 fence（3 个反引号），需要在上层做额外处理（例如替换/转义反引号，或选择更长的 fence）以避免“跳出”代码块。
- 若 `lang` 来自不可信输入，必须在上层做白名单校验/清洗（至少移除换行与反引号）。
- 若 `bullet`/`indent` 来自不可信输入，建议限制字符集并过滤控制字符，避免注入伪造段落。
- 确保在最终插值输出阶段统一调用 `escapeTemplateDelimiters`；不要在模板解析前对其做反向还原。
