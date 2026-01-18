# shared - 设计阶段共享工具

为 design stage 提供通用工具：解析 DSL/HTML、错误分类、事件安全发送等。

> **文件统计**: 4 个 JS 文件

## 模块描述

- 面向 generators/refiner/runtime 的小型工具集合，减少重复实现。
- 以“安全、可复用”为目标，提供轻量解析与容错能力。

## 核心文件

| 文件 | 职责 |
|------|------|
| `design-utils.js` | 通用工具集合与解析缓存：clamp/nowMs/safeNumber/safeInt、parseSections/joinSections/clearParseCache、extractElements、escapeHtml、hexToRgb；并 re-export value-utils 的 isPlainObject/toNonEmptyString |
| `html-parser.js` | 轻量级 HTML 起始标签属性解析 (`parseTagAttributes`) |
| `error-classifier.js` | 设计阶段错误分类与不可重试判断（委托 shared utils） |
| `safe-emit.js` | 仅在 emit 可用时安全发送事件，统一 actor=design |

## 关键概念

- 解析缓存: `parseSections()` 使用 LRUCache（最多 32 条），返回副本以避免外部修改污染缓存。
- data-el 提取: `extractElements()` 用正则抓取元素元信息，并在纯文本时生成 `textPreview`。
- 轻量解析: `parseTagAttributes()` 仅做最佳努力，不是完整 HTML tokenizer。
- 事件封装: `safeEmit()` 统一事件结构 `{ actor, status, payload }`，避免空 emit 报错。
- 错误分类: `classifyDesignError()` / `isNonRetryableError()` 复用全局错误规则。
- 兼容导出: `design-utils.js` 直接 re-export `isPlainObject`/`toNonEmptyString` 供旧代码复用。

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
import { classifyDesignError, isNonRetryableError } from 'js/agents/stages/design/shared/error-classifier.js';
import { safeEmit } from 'js/agents/stages/design/shared/safe-emit.js';

const info = classifyDesignError(err);
if (isNonRetryableError(err)) safeEmit(emit, 'design:error', 'fatal', info);
```