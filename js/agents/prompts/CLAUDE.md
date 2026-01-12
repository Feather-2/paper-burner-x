# prompts - 提示词管理

按阶段/功能组织的提示词模板。

## 目录结构

```
prompts/
├── prompt-loader.js     # 提示词加载器
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
const toolPrompt = await loadPrompt('codesearch/planning');
```

## 约定

- 每个阶段一个子目录
- 文件名反映用途：`system.md`, `planning.md`, `summarize.md`
- 使用 Markdown 格式，支持变量插值 `{{variable}}`
- 保持提示词简洁，避免冗余
