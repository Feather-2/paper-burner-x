# prompts - 提示词管理

按阶段/功能组织的提示词模板，并提供加载、渲染与注册表（浏览器优先，兼容 Node.js）。

## 目录结构

```text
prompts/
├── prompt-loader.js         # 提示词加载器（异步/同步、manifest、缓存）
├── prompt-loader-helpers.js # 加载器辅助函数（路径/URL 校验、LRU、大小限制）
├── prompt-template.js       # 模板渲染与格式化器管线
├── prompt-registry.js       # 提示词注册表（内存）
├── formatters/              # 内置格式化器
├── codesearch/              # 代码搜索提示词
├── deepsearch/              # 深度搜索提示词
├── design/                  # 设计阶段提示词
├── dsl/                     # DSL 相关提示词
└── ingest/                  # 文档摄取提示词
```

## 提示词加载

```javascript
import { loadPrompt } from 'js/agents/prompts/prompt-loader.js';

const systemPrompt = await loadPrompt('deepsearch/system');
const toolPrompt = await loadPrompt('codesearch/system', {
  manifestUrl: 'prompts/manifest.json'
});
```

### Key 约束

- 仅接受非空字符串 key。
- key 必须通过 `validateKey` 校验（防止非法路径片段）。
- 加载前会统一归一化模板变量，避免异常类型输入。

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

- 浏览器主线程：优先使用 `localStorage` 做持久缓存（读取/写入失败自动降级）。
- Web Worker / Service Worker：`localStorage` 不可用，自动降级为进程内 `Map` 内存缓存。
- 内存缓存不持久化、不会跨页面刷新/跨 worker 共享。
- 缓存键使用统一分隔符（`::`）生成，避免命名冲突。

## 安全边界

- Manifest/Prompt 文本读取均受 `maxManifestBytes` / `maxPromptBytes` 限制。
- URL 加载路径需通过 `isSafeHttpUrl` 校验。
- 本地路径读取需满足 `isPathInsideBase` 约束，防止路径穿越。
- Manifest 解析使用 `protoSafeReviver`，降低原型污染风险。
- 模板分隔符和正则相关输入会先做转义处理。

## 同步加载（Node.js）

```javascript
import { loadPromptSync } from 'js/agents/prompts/prompt-loader.js';

const prompt = loadPromptSync('dsl/ppt-html-dsl');
```

说明：

- 仅在 Node-like 环境启用同步文件读取。
- 浏览器端应使用异步 `loadPrompt`。

## 模板渲染

使用 `prompt-template.js` 的格式化器管线（支持 `{{name|upper}}` 形式的 formatter）。

```javascript
import { renderPromptTemplate } from 'js/agents/prompts/prompt-template.js';

const text = renderPromptTemplate('Hello {{name|upper}}', {
  vars: { name: 'world' }
});
```

## PromptRegistry

```javascript
import { PromptRegistry } from 'js/agents/prompts/prompt-registry.js';

const registry = new PromptRegistry();
registry.register('greeting', 'Hello {{name}}');

const output = registry.render('greeting', { name: 'Paper Burner' });
```

- `PromptRegistry` 是轻量内存注册表，适合运行时快速覆盖模板。
- 建议统一通过 `PromptTemplate` 渲染，确保 formatter 行为一致。

## 维护约定

- 保持 ES Modules + JSDoc（不引入 TypeScript 编译流程）。
- 新增公共 API 时必须补齐 `@param` / `@returns` / `@throws`。
- 任何缓存降级分支都应记录可观测日志（debug/warn），避免静默失败。
