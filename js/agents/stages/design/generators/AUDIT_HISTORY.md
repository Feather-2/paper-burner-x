# Audit History - generators

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] jsdoc:missing
*Archived: 2026-01-18T20:47:08.005Z*

- **File**: js/agents/stages/design/generators/image-generator.js:522
- **Description**: 导出辅助函数 createImageGenerator / generateImages 缺少 @param/@returns 注解。
- **Suggestion**: 补充 opts、imageSlots 等参数和返回值的 JSDoc 类型说明。
```
export function createImageGenerator(opts) {
  return new ImageGenerator(opts);
}

export async function generateImages(imageSlots, contentPackage, designSystem, opts = {}) {
```

---

## Archived: 2026-01-18

### [RESOLVED] convention:event-name
*Archived: 2026-01-18T20:46:39.648Z*

- **File**: js/agents/stages/design/generators/batch-generator.js:688
- **Description**: 事件名使用 design.batch.started/design.slide.retrying 等点分隔，未满足 domain:action 约定，可能影响事件订阅与统计一致性。
- **Suggestion**: 将事件名统一为 domain:action，例如 design:batch.started、design:slide.retrying，并集中为常量以避免漂移。
```
safeEmit(emit, "design.batch.started", "started", { batchIndex, slideIndexes, styleLock: batchIndex > 0 });
```

### [RESOLVED] jsdoc:missing
*Archived: 2026-01-18T20:46:39.648Z*

- **File**: js/agents/stages/design/generators/design-tokens.js:213
- **Description**: 导出函数 generateDesignTokens 缺少 @param/@returns 类型注解，低于 JSDoc 覆盖要求。
- **Suggestion**: 补充 JSDoc，说明 constraints 结构与返回 DesignSystem/DesignTokens 形状。
```
export function generateDesignTokens(constraints = {}) {
```

---

## Archived: 2026-01-18

### [RESOLVED] jsdoc:missing
*Archived: 2026-01-18T20:45:28.264Z*

- **File**: js/agents/stages/design/generators/svg-generator.js:540
- **Description**: fillSvgPlaceholders 只有说明性注释，缺少 @param/@returns 类型注解。
- **Suggestion**: 补充 @param html/filledSlots 与 @returns 的类型说明。
```
export function fillSvgPlaceholders(html, filledSlots) {
```

---

## Archived: 2026-01-18

### [RESOLVED] jsdoc:missing
*Archived: 2026-01-18T20:44:55.038Z*

- **File**: js/agents/stages/design/generators/batch-generator.js:634
- **Description**: generateBatch 的 JSDoc 只有 @returns，缺少 @param 注解，影响类型与调用约定可读性。
- **Suggestion**: 为 slideIntents/contentPackage/designSystemOrOptions/maybeOptions 添加 @param 说明。
```
export async function generateBatch(slideIntents, contentPackage, designSystemOrOptions = {}, maybeOptions = {}) {
```

---

## Archived: 2026-01-18

### [RESOLVED] convention:event-name
*Archived: 2026-01-18T20:43:10.313Z*

- **File**: js/agents/stages/design/generators/svg-generator.js:449
- **Description**: SVG 生成事件名采用点分隔（design.svg.generate.started 等），不符合 domain:action 规范。
- **Suggestion**: 改为 design:svg.generate.started（或其他统一 action 规则），保证域名与动作分隔一致。
```
safeEmit(emit, "design.svg.generate.started", "started", { slots: slots.length, concurrency: effectiveConcurrency });
```

---

## Archived: 2026-01-18

### [RESOLVED] security:xss
*Archived: 2026-01-18T20:42:17.509Z*

- **File**: js/agents/stages/design/generators/svg-generator.js:675
- **Description**: fillSvgPlaceholders 将 LLM/外部 SVG 内容直接拼接进 HTML，未做清洗或白名单处理，渲染时可能触发脚本/事件处理器导致 XSS。
- **Suggestion**: 对 svgContent 做严格清洗（仅允许安全标签/属性），剥离 <script>/<foreignObject>/on* 事件；或改为 data URL + <img> 渲染以隔离执行环境。
```
return { slotId, html: `<div ${attrPairs.join(" ")}>${svgContent || body}</div>` };
```

---

