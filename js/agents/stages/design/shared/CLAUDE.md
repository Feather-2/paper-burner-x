# shared - 设计阶段共享工具

为 design stage 提供通用工具：解析 DSL/HTML、错误分类、事件安全发送等。

> **文件统计**: 4 个 JS 文件

## 模块描述

- 面向 generators/refiner/runtime 的小型工具集合，减少重复实现。
- 以“安全、可复用”为目标，提供轻量解析与容错能力（包含原型污染防护与阶段特定错误规则）。
- 保持 Browser-first + Node.js compatible，不依赖 Node-only API。

## 核心文件

| 文件 | 职责 |
|------|------|
| `design-utils.js` | 通用工具集合与解析缓存：`clamp`/`nowMs`/`safeNumber`/`safeInt`、`parseSections`/`joinSections`/`clearParseCache`、`extractElements`、`escapeHtml`、`hexToRgb`；并 re-export `isPlainObject`/`toNonEmptyString` 供旧代码复用 |
| `html-parser.js` | 轻量级 HTML 起始标签属性解析（`parseTagAttributes`）；过滤 `__proto__`/`constructor`/`prototype` 等键以降低原型污染风险 |
| `error-classifier.js` | 设计阶段错误分类与不可重试判断：委托 shared utils，并额外支持 `err.nonRetryable === true` 快速标记不可重试 |
| `safe-emit.js` | 仅在 `emit` 可用时安全发送事件，统一 `actor=design` |

## 关键概念

- 解析缓存：`parseSections()` 使用 LRUCache（最多 32 条），返回副本以避免外部修改污染缓存。
- data-el 提取：`extractElements()` 用正则抓取元素元信息，并在纯文本时生成 `textPreview`。
- 轻量解析：`parseTagAttributes()` 仅做 best-effort，不是完整 HTML tokenizer；会跳过禁止键以降低原型污染风险。
- 事件封装：`safeEmit()` 统一事件结构 `{ actor, status, payload }`，避免空 emit 报错。
- 错误分类：`classifyDesignError()` 复用全局错误规则；`isNonRetryableError()` 在全局规则基础上额外识别 `err.nonRetryable === true`。
- 兼容导出：`design-utils.js` 直接 re-export `isPlainObject`/`toNonEmptyString` 供旧代码复用。

## 安全与兼容要点

- 防原型污染：属性解析时显式忽略危险键（`__proto__`、`constructor`、`prototype`）。
- XSS 基线：渲染文本前优先使用 `escapeHtml()` 处理不可信内容。
- 事件发送安全：通过 `safeEmit()` 统一兜底，避免 `emit` 未定义引发运行时错误。
- 跨端兼容：本目录工具函数应保持 ESM 与浏览器环境优先，不引入 `fs/path/process` 等 Node-only API。

## 常见任务

```javascript
import {
  parseSections,
  joinSections,
  extractElements,
  clearParseCache,
} from 'js/agents/stages/design/shared/design-utils.js';

// 解析/拼接 deck DSL
const sections = parseSections(deckHtmlDsl);
// ...编辑 sections
const nextDsl = joinSections(sections);
clearParseCache();

// 提取 data-el 元信息
const elements = extractElements(sections[0]);
```

```javascript
import { isPlainObject, toNonEmptyString } from 'js/agents/stages/design/shared/design-utils.js';

const obj = isPlainObject(input) ? input : null;
const label = toNonEmptyString(title) ?? 'Untitled';
```

```javascript
import { parseTagAttributes } from 'js/agents/stages/design/shared/html-parser.js';

const attrs = parseTagAttributes('<div class="x" data-id="1">');
```

```javascript
import {
  classifyDesignError,
  isNonRetryableError,
} from 'js/agents/stages/design/shared/error-classifier.js';

const normalized = classifyDesignError(error);
if (isNonRetryableError(error)) {
  // 直接终止重试
}
```

```javascript
import { safeEmit } from 'js/agents/stages/design/shared/safe-emit.js';

safeEmit(emit, 'design:step', {
  stage: 'refiner',
  slideId: 'slide-1',
}, 'running');
```