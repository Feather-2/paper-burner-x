# Audit History - textprep

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] error-handling
*Archived: 2026-01-20T00:33:37.306Z*

- **File**: js/agents/stages/textprep/index.js:133
- **Description**: 存在空 catch 块吞掉异常（resolveErrorBoundary / run），违反错误处理规范，排障困难。
- **Suggestion**: 至少记录错误上下文并说明可忽略原因，或捕获特定异常后重新抛出。
```
} catch {
```

### [RESOLVED] jsdoc
*Archived: 2026-01-20T00:33:37.306Z*

- **File**: js/agents/stages/textprep/index.js:246
- **Description**: 导出的 TextPrepStage 与 runTextPrepStage 缺少完整 JSDoc（@param/@returns/@throws）。
- **Suggestion**: 为类与导出函数补充完整 JSDoc，明确参数、返回值与可能抛出的异常。
```
export class TextPrepStage extends BaseStage {
```

### [RESOLVED] jsdoc
*Archived: 2026-01-20T00:33:37.306Z*

- **File**: js/agents/stages/textprep/slideplan.js:202
- **Description**: 兼容导出 generateSlideIntents 缺少 JSDoc / @deprecated 说明，API 可见性不清晰。
- **Suggestion**: 为该导出添加 JSDoc 或 @deprecated 注记，说明用途与替代方式。
```
export const generateSlideIntents = planSlides;
```

### [RESOLVED] style
*Archived: 2026-01-20T00:33:37.306Z*

- **File**: js/agents/stages/textprep/index.js:252
- **Description**: TextPrepStage.run 体积过大且嵌套层级较深，违反函数长度与嵌套约束，维护成本高。
- **Suggestion**: 拆分为若干独立 helper（normalize/chunk/slideplan/align/build），降低嵌套与函数长度。
```
  async run(input, context = {}) {
```

---

## Archived: 2026-01-18

### [RESOLVED] error-handling
*Archived: 2026-01-18T20:43:47.955Z*

- **File**: js/agents/stages/textprep/index.js:216
- **Description**: catch 块吞掉异常且未记录或抛出，排障困难且违反错误处理规范（slideplan.js 同类 catch 也存在）。
- **Suggestion**: 至少记录错误上下文（logger/trace），必要时包装后 rethrow，再执行降级逻辑。
```
} catch {
```

---

## Archived: 2026-01-18

### [RESOLVED] jsdoc
*Archived: 2026-01-18T20:43:22.905Z*

- **File**: js/agents/stages/textprep/build-content-package.js:53
- **Description**: 导出函数缺少完整 JSDoc（@param/@returns 描述），私有 helper 也未标注 @private。
- **Suggestion**: 为 deriveSummary 补全 JSDoc，并为非导出 helper 添加 `/** @private */` 标记。
```
export function deriveSummary(sourceTextNormalized, claims) {
```

---

## Archived: 2026-01-18

### [RESOLVED] unsafe-deserialization
*Archived: 2026-01-18T20:43:16.323Z*

- **File**: js/agents/stages/textprep/index.js:200
- **Description**: LLM 返回内容直接 JSON.parse，未做结构/大小验证。
- **Suggestion**: 在 parse 前做长度限制，parse 后做结构验证与字段白名单过滤。
```
const parsed = JSON.parse(candidate);
```

---

## Archived: 2026-01-18

### [RESOLVED] input-validation
*Archived: 2026-01-18T20:41:16.639Z*

- **File**: js/agents/stages/textprep/index.js:15
- **Description**: 来自 UI 的输入仅做类型判断，未限制长度/条数，可能导致超大输入引发性能或内存问题。
- **Suggestion**: 为 input.text/rawText/sources 增加长度与条数上限，必要时截断并返回用户友好错误。
```
function toRawText(input) {
```

---

## Archived: 2026-01-18

### [RESOLVED] timeout-missing
*Archived: 2026-01-18T20:40:20.110Z*

- **File**: js/agents/stages/textprep/slideplan.js:163
- **Description**: LLM 调用未设置超时/AbortSignal，可能长时间阻塞 textprep（alignClaimsToSlides 也有同类调用）。
- **Suggestion**: 为 chat 调用增加超时或 AbortSignal，或在 aiApiService 层统一超时策略。
```
const result = await aiApiService.chat({
```

---

## Archived: 2026-01-18

### [RESOLVED] unsafe-deserialization
*Archived: 2026-01-18T20:39:44.294Z*

- **File**: js/agents/stages/textprep/slideplan.js:25
- **Description**: LLM 输出的 JSON 直接解析，未做长度/结构校验，可能导致拒绝服务或异常结构绕过。
- **Suggestion**: 限制 candidate 长度/字符集，parse 后做 schema 校验并过滤字段，必要时记录解析失败原因。
```
const parsed = JSON.parse(candidate);
```

---

