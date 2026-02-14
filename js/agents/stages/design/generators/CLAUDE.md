# generators (design) - 生成器

幻灯片内容与视觉资产生成（Browser-first, Node.js compatible）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `design-tokens.js` | 设计令牌生成/校验 |
| `design-system-generator.js` | DesignSystem 生成与 overrides 合并（含 visualPreference 规范化、原型污染防护） |
| `layout-generator.js` | 布局原型 HTML 生成 |
| `layout-protocol.js` | 布局类型/区域协议 |
| `image-generator.js` | ImageGenerator - 图像生成/填充 |
| `svg-generator.js` | SVGGenerator - SVG 生成/填充 |
| `batch-generator.js` | 批量生成主编排（prompt 加载/缓存、模型调用、资源守卫、事件上报） |
| `batch-generator-helpers.js` | 批量生成辅助（HTML 清洗、DSL 规范化、内容归一化、视觉槽位注入、样式描述） |

## 设计令牌

```javascript
import { generateDesignTokens } from 'js/agents/stages/design/generators';

const { theme, designTokens } = generateDesignTokens({
  theme: 'dark',
  fontFamily: 'Inter',
  safeMarginPct: 8,
});
// -> { theme, visualPreference, designTokens: { colors, typography, spacing, grid, visualPreference } }
```

## 设计系统

```javascript
import { generateDesignSystem } from 'js/agents/stages/design/generators/design-system-generator.js';

const system = await generateDesignSystem(
  {
    contentSummary: '...',
    tone: 'calm',
    userPreferences: { designSystemOverrides: { typography: { lineHeight: 1.3 } } },
  },
  { modelRouter, aiApiService, constraints: { safeMarginPct: 8 } }
);
// -> validated DesignSystem (+ legacy designTokens sync)
```

说明：
- `designSystemOverrides` 使用深度合并（overrides 优先），并过滤 `__proto__`/`prototype`/`constructor` 键以避免原型污染。
- `visualPreference` 支持 string（如 `'dark'`）或对象（如 `{ mode: 'dark' }`），内部会将 `mode` 规范化为小写。

## 批量生成（主编排）

- system prompt 通过 `loadPrompt('design/batch-generator-system')` 外置加载；内部做缓存：
  - `_cachedSystemPrompt`：缓存已加载内容
  - `_systemPromptLoadPromise`：缓存进行中的加载 Promise，避免并发重复加载
- 加载失败时回退到内置 `FALLBACK_SYSTEM_PROMPT`。
- 主流程中建议用 `ResourceGuard` 包裹长耗时调用（模型生成/修复）以限制超时与资源占用。
- 事件上报建议统一通过 `safeEmit(...)`，避免观测逻辑影响主路径。

## 批量生成辅助（新增：`batch-generator-helpers.js`）

### 常量
- `BATCH_GENERATOR_DEFAULTS.maxContentLength`：正文截断长度（默认 `800`）。
- `ALLOWED_TAGS`：允许的 HTML/SVG 标签白名单。
- `VOID_TAGS`：自闭合标签集合（如 `img`/`br`）。

### 典型能力
- 基础工具：`nowMs`、`chunkIndexes`
- 结构判断：`looksLikeSlideHtml`、`extractSectionBlock`、`ensureSectionAttr`
- 安全清洗：`sanitizeSlideHtml`
- DSL 归一化：`normalizeDslRules`
- 输入归一化：`normalizeSlideIntentContentForPrompt`、`normalizeSelectedIdeas`
- 视觉提示注入：`applyVisualSlotHintsToSlideHtml`
- 风格描述构建：`buildStyleDescription`

## 安全与稳健性约束

- 模型输出视为不可信输入：先做 JSON 候选提取与结构校验，再进入 HTML/DSL 组装。
- HTML/SVG 必须经过白名单清洗：
  - 禁止事件属性（`on*`）
  - 限制 `src`/`href`/`xlink:href` 协议
  - 限制 style 内联中的危险 URL 形式
- 对输入规模设置上限：文本长度、数组长度、属性数量均应可配置并有硬上限。
- 对异常路径保留可观测性：记录错误类型与上下文，避免空 catch。

## 测试建议（本模块）

- 正常路径：批量生成 -> 解析 -> 清洗 -> 渲染 DSL。
- 异常恢复：prompt 加载失败回退、模型返回非法 JSON、HTML 修复失败回退。
- 边界输入：空内容、超长内容、恶意属性（`onload`/`javascript:`）、深层嵌套标签。
- 稳定性：并发调用 `getSystemPrompt()`、快速连续批处理、超时中断与回滚。