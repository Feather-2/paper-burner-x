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
const toolPrompt = await loadPrompt('codesearch/system', {
  manifestUrl: 'prompts/manifest.json'
});
```

## PromptLoader 实例与缓存

```javascript
import {
  PromptLoader,
  configurePromptCache,
  clearPromptCache,
  getCachedPromptNames
} from 'js/agents/prompts/prompt-loader.js';

const loader = new PromptLoader({
  basePath: '/js/agents/prompts/',
  maxEntries: 256,
  manifestTtlMs: 300_000,
  maxManifestBytes: 512 * 1024,
  maxPromptBytes: 2 * 1024 * 1024,
  fetchImpl: fetch
});

const text = await loader.loadPrompt('design/system');

configurePromptCache({ maxEntries: 256, manifestTtlMs: 300_000 });
clearPromptCache('design/system');
const cached = getCachedPromptNames();
```

## 同步加载（Node.js）

```javascript
import { loadPromptSync } from 'js/agents/prompts/prompt-loader.js';

const prompt = loadPromptSync('dsl/ppt-html-dsl');
```

## 模板渲染

```javascript
import { renderPromptTemplate } from 'js/agents/prompts/prompt-template.js';

const text = renderPromptTemplate('Hello {{name|upper}}', {
  vars: { name: 'world' }
});
```

## 轻量渲染（无 formatter 管线）

```javascript
import { renderPromptTemplate } from 'js/agents/prompts/prompt-loader.js';

const text = renderPromptTemplate('Hello {{name}}', {
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
- 浏览器端默认读取 `prompts/manifest.json`，兜底 `public/prompts/manifest.json`
- 轻量渲染不支持 formatter 管线，需要格式化请用 `prompt-template.js`
- `loadPromptSync` 仅在 Node.js 环境使用
- 保持提示词简洁，避免冗余
