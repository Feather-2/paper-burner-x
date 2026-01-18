# Audit History - banana

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] timeout-handling
*Archived: 2026-01-18T20:49:45.439Z*

- **File**: js/agents/stages/design/banana/banana-generator.js:210
- **Description**: 仅在循环开始前检查 signal，且 imageGenerator.generate 没有超时/取消机制；生成卡住时无法中断，regenerate 也未使用 signal。
- **Suggestion**: 为每次生成增加超时（AbortController/Promise.race），并让 imageGenerator 支持 signal；signal abort 时应停止循环并返回已完成/取消的结果。
```
if (signal?.aborted) {
  results.push({
    slideIndex: item.slideIndex,
    success: false,
    error: "Cancelled",
  });
  continue;
}
const image = await imageGenerator.generate({
```

### [RESOLVED] error-handling
*Archived: 2026-01-18T20:49:45.439Z*

- **File**: js/agents/stages/design/banana/banana-generator.js:245
- **Description**: 直接透出 err.message 可能把内部错误信息返回给用户，也不符合自定义 Error 分类要求。
- **Suggestion**: 使用自定义 Error 类型并映射为用户友好的 message，内部细节记录在日志中。
```
error: err.message,
```

### [RESOLVED] unused-options
*Archived: 2026-01-18T20:49:45.439Z*

- **File**: js/agents/stages/design/banana/banana-generator.js:186
- **Description**: concurrency 与 retryCount 配置未被使用，regenerate 中的 signal 也未使用，容易让调用方误解能力。
- **Suggestion**: 实现并发/重试与取消逻辑，或移除相关配置与参数以避免误导。
```
concurrency = BANANA_CONFIG.maxConcurrency,
```

### [RESOLVED] test-quality
*Archived: 2026-01-18T20:49:45.439Z*

- **File**: tests/agents/stages/design/banana-generator.test.js:150
- **Description**: 存在伪测试：仅调用不做断言，无法验证行为。
- **Suggestion**: 为 setImageGenerator 添加可观察行为断言，例如调用 generate 并断言 mockGenerator 被使用，或提供 getter 仅供测试。
```
generator.setImageGenerator(mockGenerator);
// No error means success
```

---

## Archived: 2026-01-18

### [RESOLVED] jsdoc
*Archived: 2026-01-18T20:40:47.294Z*

- **File**: js/agents/stages/design/banana/banana-generator.js:99
- **Description**: JSDoc 中存在 any 类型且多个 public API 的 @param/@returns 缺少描述，不符合规范。
- **Suggestion**: 为 emit 定义具体事件类型（可用 @typedef 联合类型），并为所有 @param/@returns 添加简短描述。
```
@property {(name: string, event: any) => void} [emit]
```

---

## Archived: 2026-01-18

### [RESOLVED] event-naming
*Archived: 2026-01-18T20:40:46.433Z*

- **File**: js/agents/stages/design/banana/banana-generator.js:221
- **Description**: 事件名使用点号，不符合约定的 domain:action 格式。
- **Suggestion**: 改为 `banana:generating` / `banana:completed` / `banana:regenerating`，或在规范中明确允许点号格式。
```
emit?.("banana.generating", {
```

---

## Archived: 2026-01-18

### [RESOLVED] logic
*Archived: 2026-01-18T20:40:45.577Z*

- **File**: js/agents/stages/design/banana/banana-generator.js:238
- **Description**: 生成结果在未返回 url/base64 时仍标记 success=true，可能产生“成功但无图”的结果。
- **Suggestion**: 校验 image?.url 或 image?.base64，缺失时将该项标记为失败并返回明确错误。
```
results.push({
  slideIndex: item.slideIndex,
  slideIntentId: item.slideIntentId,
  success: true,
  image: image?.url || image?.base64,
  prompt: item.prompt,
});
```

---

## Archived: 2026-01-18

### [RESOLVED] input-validation
*Archived: 2026-01-18T20:39:17.925Z*

- **File**: js/agents/stages/design/banana/banana-generator.js:181
- **Description**: runBananaGenerate 对 slideIntents 和 designSystem 没有做类型/结构校验，来自 UI 的异常输入会导致运行时错误或生成异常 prompt。
- **Suggestion**: 对 slideIntents 做 Array.isArray 校验并验证每项字段类型；designSystem 仅接受对象并过滤非字符串字段，发现异常时返回友好错误。
```
for (let i = 0; i < slideIntents.length; i++) {
  const intent = slideIntents[i];
  const prompt = buildImagePrompt(intent, designSystem, options);
```

---

