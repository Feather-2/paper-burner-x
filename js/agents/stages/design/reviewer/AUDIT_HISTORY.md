# Audit History - reviewer

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] JSDoc-any-usage
*Archived: 2026-01-18T22:06:18.136Z*

- **File**: js/agents/stages/design/reviewer/auto-reviewer.js:17
- **Description**: 多个公开类型与参数仍使用 `any`/`any[]`，违反“禁止 any”并削弱输入验证。
- **Suggestion**: 为 slidesMeta、designSystem、options 等定义具体 @typedef（如 SlidesMeta、DesignSystem、ReviewOptions），替换 any/any[]，并在导出 API 上补全类型。
```
@property {any[]} [slidesMeta]
@property {any} designSystem
@property {any} options
```

### [RESOLVED] input-validation
*Archived: 2026-01-18T22:06:18.136Z*

- **File**: js/agents/stages/design/reviewer/auto-reviewer.js:144
- **Description**: 来自 UI 的 deckPackage/designSystem 未做类型校验，非字符串 deckHtmlDsl 或异常结构会在 collectAllDsl/matchAll 处抛错。
- **Suggestion**: 在 buildReviewContext/runAutoReview 中验证 deckHtmlDsl 为字符串、slidesMeta 为数组；无效时返回友好错误或抛出自定义 Error，并在 JSDoc 标注 @throws。
```
const allDsl = collectAllDsl(deckPackage?.deckHtmlDsl || "");
```

### [RESOLVED] timeout-cancel-missing
*Archived: 2026-01-18T22:06:18.136Z*

- **File**: js/agents/stages/design/reviewer/auto-reviewer.js:349
- **Description**: runAutoReview 接收 options（上游会传入 signal），但当前流程未检查 abort/超时，长文档或后续截图分析无法中断。
- **Suggestion**: 在循环中检查 options.signal?.aborted，或把 signal 传入 analyzer/stitcher；必要时加超时与早退逻辑。
```
export async function runAutoReview(deckPackage, designSystem, options = {}) {
  const context = buildReviewContext(deckPackage, designSystem, options);
```

### [RESOLVED] unused-deps-dead-code
*Archived: 2026-01-18T22:06:18.136Z*

- **File**: js/agents/stages/design/reviewer/auto-reviewer.js:10
- **Description**: analyzeStyleConsistency 未使用，_analyzer/_stitcher 字段及 expectedFonts 仅初始化未参与逻辑，易造成维护混淆。
- **Suggestion**: 移除未使用依赖/字段，或补齐调用逻辑（如使用 analyzer 进行截图/风格分析、用 expectedFonts 做偏离检测）。
```
import { createDeckAnalyzer, analyzeStyleConsistency, collectAllDsl } from "../runtime/deck-analyzer.js";
```

### [RESOLVED] jsdoc-public-export
*Archived: 2026-01-18T22:06:18.136Z*

- **File**: js/agents/stages/design/reviewer/auto-reviewer.js:83
- **Description**: 公开常量缺少完整 JSDoc/@type 注解，不符合“public API 必须有完整 JSDoc”。
- **Suggestion**: 为 REVIEW_CONFIG/IssueType/IssueSeverity 添加 @typedef/@type 与字段说明。
```
/**
 * 审查配置
 */
export const REVIEW_CONFIG = {
```

### [RESOLVED] test-coverage-gap
*Archived: 2026-01-18T22:06:18.136Z*

- **File**: tests/agents/stages/design/auto-reviewer.vitest.test.js:4
- **Description**: 测试以全量 mock 为主，缺少与设计阶段集成、异常中断恢复与边界输入（空值/超长 DSL/并发）覆盖。
- **Suggestion**: 补充与 runBatchRepairPhase 的集成测试，以及异常恢复、超时/取消、边界输入与并发调用用例。
```
vi.mock("../../../../js/agents/stages/design/runtime/deck-analyzer.js", () => {
```

---

