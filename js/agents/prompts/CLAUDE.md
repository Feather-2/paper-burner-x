# prompts - 提示词管理

按阶段/功能组织的提示词模板，并提供加载、渲染与注册表（浏览器优先，兼容 Node.js）。

## 目录结构

```
prompts/
├── prompt-loader.js     # 提示词加载器（含缓存/manifest）
├── prompt-template.js   # 模板渲染与格式化器管线
├── prompt-registry.js   # 提示词注册表（内存）
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

### 缓存的跨环境行为

- 浏览器主线程：优先使用 `localStorage` 做持久缓存（读取/写入失败时会自动降级）。
- Web Worker / Service Worker：`localStorage` 不可用，自动降级为进程内 `Map` 内存缓存。
- 内存缓存不持久化、不会跨页面刷新/跨 worker 共享。

## 同步加载（Node.js）

```javascript
import { loadPromptSync } from 'js/agents/prompts/prompt-loader.js';

const prompt = loadPromptSync('dsl/ppt-html-dsl');
```

## 模板渲染

使用 `prompt-template.js` 的格式化器管线（支持 `{{name|upper}}` 形式的 formatter）。

```javascript
import { renderPromptTemplate } from 'js/agents/prompts/prompt-template.js';

const text = renderPromptTemplate('Hello {{name|upper}}', {
  vars: { name: 'world' }
});
```

## 轻量渲染（无 formatter 管线）

当你只需要最基础的 `{{var}}` 替换、且不希望启用 formatter 管线时：

```javascript
import { renderPromptTemplate } from 'js/agents/prompts/prompt-loader.js';

const text = renderPromptTemplate('Hello {{name}}', {
  vars: { name: 'world' }
});
```

## PromptRegistry（内存注册表）

适用于把常用模板注册到内存中，按名称取用；支持单个注册与批量注册。

```javascript
import { PromptRegistry } from 'js/agents/prompts/prompt-registry.js';
import { PromptTemplate } from 'js/agents/prompts/prompt-template.js';

const registry = new PromptRegistry();

registry.register('greeting', 'Hello {{name}}');

registry.registerMany({
  farewell: 'Bye {{name}}',
  loud: new PromptTemplate('HELLO {{name|upper}}')
});

const tpl = registry.get('greeting');
```