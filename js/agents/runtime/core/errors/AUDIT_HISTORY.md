# Audit History - errors

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] 未验证的输入
*Archived: 2026-01-18T21:13:35.387Z*

- **File**: js/agents/runtime/errors/silent-error-reporter.js:99
- **Description**: report 直接读取 context.location/category/operation，未验证 context 是否为对象或 location 是否为字符串；错误调用会抛 TypeError，可能在错误处理路径中再次中断。
- **Suggestion**: 在 report 入口处校验 context 为对象且 location 为非空字符串；无效时回退到 'unknown' 或直接返回。
```
const entry = {
  location: context.location,
  category: context.category ?? ErrorCategory.RECOVERABLE,
  operation: context.operation,
};
```

### [RESOLVED] 原型污染风险
*Archived: 2026-01-18T21:13:35.387Z*

- **File**: js/agents/runtime/errors/silent-error-reporter.js:132
- **Description**: _groupBy 使用动态 key 累加统计；若 location/category 可被外部输入影响，__proto__/constructor 等键可能污染原型。
- **Suggestion**: 改用 Object.create(null) 或 Map 存储统计，并过滤 __proto__/constructor/prototype 等危险 key。
```
const groups = {};
for (const sample of this._samples) {
  const value = sample[key] ?? 'unknown';
  groups[value] = (groups[value] ?? 0) + 1;
}
```

### [RESOLVED] 错误处理
*Archived: 2026-01-18T21:13:35.387Z*

- **File**: js/agents/runtime/errors/silent-error-reporter.js:113
- **Description**: onError 回调异常被空 catch 吞掉，违反“异常需记录或重新抛出”的规范，排障困难。
- **Suggestion**: 在不影响主流程的前提下记录异常（logger.error 或追加到 samples），避免完全静默。
```
if (this._onError) {
  try {
    this._onError(entry);
  } catch {
    // Prevent callback errors from propagating
  }
}
```

### [RESOLVED] 资源管理
*Archived: 2026-01-18T21:13:35.387Z*

- **File**: js/agents/runtime/errors/silent-error-reporter.js:62
- **Description**: maxSamples 未校验为有限正数；若为 NaN/Infinity/负值，ring buffer 可能失效导致样本无限增长。
- **Suggestion**: 构造函数中校验 maxSamples 为有限正数，非法值回退默认值并可进行上限 clamp。
```
/** @type {number} */
this._maxSamples = options.maxSamples ?? 100;
```

---

