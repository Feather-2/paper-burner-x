# formatters - 提示词格式化器

## 模块描述
为 prompt-template 的 `{{var|formatter}}` 渲染管道提供内置格式化器，并在插值输出前进行安全转义，避免模板占位符被注入。

## 核心文件

| 文件 | 作用 |
|------|------|
| `index.js` | 导出格式化器并定义 `DEFAULT_FORMATTERS` 映射 |
| `escape-template-delimiters.js` | 转义 `{{`/`}}`，防止二次模板解析 |
| `format-bullets.js` | 列表转为 Markdown bullet |
| `format-code-block.js` | 生成 fenced code block |
| `format-json.js` | JSON 美化输出（支持 space 参数） |
| `format-lines.js` | 数组/字符串转行文本 |
| `format-trim.js` | 去除首尾空白 |
| `format-upper.js` | 转大写 |

## 关键概念

- **格式化器签名**：`(value, ctx?) => string`，`ctx.args` 来自 `{{var|name(arg1,arg2)}}`。
- **格式化管道**：占位符可串联多个 formatter，顺序执行（如 `json` → `code`）。
- **默认表**：`DEFAULT_FORMATTERS` 提供 `bullets`/`code`/`json`/`lines`/`trim`/`upper`。
- **安全转义**：`escapeTemplateDelimiters` 在输出中插入零宽字符，阻断 `{{`/`}}`。

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

- 新增 formatter：新增 `format-xxx.js` 并导出函数，然后在 `index.js` 中导出并加入 `DEFAULT_FORMATTERS`。
- 运行时注入自定义 formatter

```javascript
renderPromptTemplate(tpl, {
  vars,
  formatters: { slug: (v) => String(v ?? "").toLowerCase() },
});
```
