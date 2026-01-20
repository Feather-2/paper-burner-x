# Audit History - tokenizers

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] 竞态条件
*Archived: 2026-01-20T00:16:21.799Z*

- **File**: js/agents/shared/tokenizers/adaptive-token-counter.js:220
- **Description**: dispose() 仅清理状态但未防护进行中的 initPromise 或延迟 warmup；pending init 可能在 dispose 后完成并重新设置 encoder/ready，导致生命周期不一致。
- **Suggestion**: 引入 disposed 标记并在 init 结果落地前检查；记录 warmup 的定时器 id 并在 dispose 中清理，或使用 generation token 进行状态门控。
```
  const dispose = () => {
    try {
      if (encoder && typeof encoder.free === "function") encoder.free();
    } catch {
      // ignore
    } finally {
      encoder = null;
      ready = false;
      mode = "heuristic";
      failed = false;
      initPromise = null;
    }
  };
```

### [RESOLVED] 错误处理
*Archived: 2026-01-20T00:16:21.799Z*

- **File**: js/agents/shared/tokenizers/adaptive-token-counter.js:9
- **Description**: 多处 catch 吞掉异常（JSON.stringify、encoding 查找、console 调用、encoder.free），可能掩盖异常并违背错误处理规范。
- **Suggestion**: 对非预期异常进行 onLog/console 记录，或明确注释为何可忽略；尽量缩小 catch 范围。
```
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
```

### [RESOLVED] 可维护性
*Archived: 2026-01-20T00:16:21.799Z*

- **File**: js/agents/shared/tokenizers/adaptive-token-counter.js:155
- **Description**: createAdaptiveTokenCounter 超过 50 行，混合初始化、warmup、计数与状态管理，违反单一职责/长度约束。
- **Suggestion**: 拆分 init 处理、warmup 调度、计数逻辑为独立私有函数，以控制单函数长度与职责。
```
export function createAdaptiveTokenCounter(options = {}) {
```

### [RESOLVED] JSDoc
*Archived: 2026-01-20T00:16:21.799Z*

- **File**: js/agents/shared/tokenizers/adaptive-token-counter.js:6
- **Description**: 内部辅助函数缺少 /** @private */ 标记（如 toText、pickEncoding、loadTiktoken、scheduleWarmup、parseWarmupOptions）。
- **Suggestion**: 为内部函数补充 /** @private */ 注解以符合项目 JSDoc 规范。
```
function toText(value) {
```

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

