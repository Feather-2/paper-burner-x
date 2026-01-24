# formatters - 提示词格式化器

## 模块描述
为 prompt-template 的 `{{var|formatter}}` 渲染管道提供内置格式化器。格式化器负责把变量值转换为更适合 prompt 的文本，并配合 `escapeTemplateDelimiters` 在插值输出中打断 `{{`/`}}`，避免用户内容注入新的模板占位符。

## 核心文件

| 文件 | 作用 |
|------|------|
| `index.js` | 导出格式化器并定义 `DEFAULT_FORMATTERS` 映射 |
| `escape-template-delimiters.js` | 在输出中打断 `{{`/`}}`（零宽字符），防止二次模板解析 |
| `format-bullets.js` | 列表/多行文本转为 Markdown bullet（支持 `bullet`/`indent` 选项） |
| `format-code-block.js` | 生成 fenced code block（支持 `lang` 选项） |
| `format-json.js` | JSON 美化输出（`space` 缩进；可选 `onError` 回调） |
| `format-lines.js` | 数组/字符串转行文本 |
| `format-trim.js` | 去除首尾空白 |
| `format-upper.js` | 转大写 |

## 关键概念

- **格式化器签名**：`(value, options?) => string`，`options` 为可选配置对象（通常由模板调用参数解析而来）。
- **格式化管道**：占位符可串联多个 formatter，顺序执行（如 `json` → `code`）。
- **默认表**：`DEFAULT_FORMATTERS` 提供 `bullets`/`code`/`json`/`lines`/`trim`/`upper`。
- **安全转义**：`escapeTemplateDelimiters` 在输出中插入零宽字符阻断 `{{`/`}}`（实现避免依赖 `replaceAll` 以兼容较老浏览器）。

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
  - `code`: `{ lang }`
  - `json`: `{ space, onError? }`（`onError` 通常仅用于运行时注入/调用）

- 新增 formatter：新增 `format-xxx.js` 并导出函数（建议采用 `(value, options)` 签名），然后在 `index.js` 中导出并加入 `DEFAULT_FORMATTERS`。
- 运行时注入自定义 formatter

```javascript
renderPromptTemplate(tpl, {
  vars,
  formatters: { slug: (v) => String(v ?? "").toLowerCase() },
});
```

- 安全提示：`code` formatter 仅负责包裹 fenced code block；如果输入可能包含 fence（3 个反引号）或 `lang` 含换行/特殊字符，需要在上层做额外处理以避免“跳出”代码块。