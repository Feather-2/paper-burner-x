# prompts - 提示词管理

按阶段/功能组织的提示词模板，并提供加载、渲染与注册表。

## 目录结构

```
prompts/
├── prompt-loader.js     # 提示词加载器（含缓存/manifest）
├── prompt-template.js   # 模板渲染与格式化器管线
├── prompt-registry.js   # 提示词注册表
├── formatters/          # 内置格式化器
├── codesearch/          # 代码搜索提示词
├── deepsearch/          # 深度搜索提示词
├── design/              # 设计阶段提示词
├── dsl/                 # DSL 相关提示词
└── ingest/              # 文档摄取提示词
```

## 提示词加载

```javascript
import { loadPrompt } from 'js/agents/prompts/prompt-loader.js';

const systemPrompt = await loadPrompt('deepsearch/system');
const toolPrompt = await loadPrompt('codesearch/system');
```

## 模板渲染

```javascript
import { renderPromptTemplate } from 'js/agents/prompts/prompt-template.js';

const text = renderPromptTemplate('Hello {{name|upper}}', {
  vars: { name: 'world' }
});
```

## 注册表

```javascript
import { PromptRegistry } from 'js/agents/prompts/prompt-registry.js';

const registry = new PromptRegistry();
registry.register('greeting', 'Hello {{name}}');
const rendered = registry.render('greeting', { vars: { name: 'World' } });
```

## 约定

- 每个阶段一个子目录
- 文件名反映用途：`system.md`, `planning.md`, `summarize.md`
- 使用 Markdown 格式，支持变量插值 `{{variable}}` 与格式化器管线 `{{var|json}}`
- 内置格式化器：`bullets`, `code`, `json`, `lines`, `trim`, `upper`
- 保持提示词简洁，避免冗余
