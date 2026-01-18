# Audit History - tokenizers

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] JSDoc
*Archived: 2026-01-18T21:27:48.359Z*

- **File**: js/agents/shared/tokenizers/adaptive-token-counter.js:54
- **Description**: TokenCounter.count 使用 any 类型，违反禁止 any 的约定。
- **Suggestion**: 定义明确的输入类型（例如 `TokenCounterInput`），并将 any 替换为该类型。
```
@property {(value:any)=>number} count Synchronous, always returns a number.
```

### [RESOLVED] JSDoc
*Archived: 2026-01-18T21:27:48.359Z*

- **File**: js/agents/shared/tokenizers/adaptive-token-counter.js:66
- **Description**: createAdaptiveTokenCounter 与内部 init 的 JSDoc 缺少参数/返回值描述。
- **Suggestion**: 为每个 @param/@returns 补充描述文本，符合项目 JSDoc 规范。
```
@param {object} [options]
@param {string} [options.model]
@returns {TokenCounter}
```

### [RESOLVED] CodeStyle
*Archived: 2026-01-18T21:27:48.359Z*

- **File**: js/agents/shared/tokenizers/adaptive-token-counter.js:74
- **Description**: createAdaptiveTokenCounter 函数过长且承担多职责，违反单一职责/≤50 行约束。
- **Suggestion**: 提取日志构造、初始化、warmup 等为独立私有函数以缩短主体。
```
export function createAdaptiveTokenCounter(options = {}) {
```

### [RESOLVED] TestQuality
*Archived: 2026-01-18T21:27:48.359Z*

- **File**: tests/agents/adaptive-token-counter.test.js:144
- **Description**: tests/agents/adaptive-token-counter.test.js 存在无断言测试（伪测试），降低测试有效性。
- **Suggestion**: 为这些用例添加明确断言（例如验证 onLog 被调用、warmup 触发 init），或删除该文件并合并到更完整的 suite。
```
it("accepts onLog callback", () => {
  let logged = false;
  const counter = createAdaptiveTokenCounter({
```

### [RESOLVED] TestQuality
*Archived: 2026-01-18T21:27:48.359Z*

- **File**: tests/agents/runtime/adaptive-token-counter.test.js:59
- **Description**: 重复测试：shared 与 runtime 两套 vitest 文件几乎一致，另有一份基础测试，易引发维护分叉。
- **Suggestion**: 保留单一权威 suite，并将 runtime 相关断言单独抽成小测试。
```
describe("shared/tokenizers/adaptive-token-counter", () => {
```

### [RESOLVED] TestCoverage
*Archived: 2026-01-18T21:27:48.359Z*

- **File**: tests/agents/shared/tokenizers.vitest.test.js:65
- **Description**: 边界条件测试缺失：未覆盖 0/-1/MAX_SAFE_INTEGER、纯空白字符串、超长字符串、并发/连续调用等必测场景。
- **Suggestion**: 补充上述边界与并发场景测试，确保满足必测要求。
```
it("counts tokens heuristically and handles CJK + non-string values", async () => {
```

---

