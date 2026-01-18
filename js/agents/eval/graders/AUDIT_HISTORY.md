# Audit History - graders

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] input_validation
*Archived: 2026-01-18T21:06:58.773Z*

- **File**: js/agents/eval/graders/content.js:287
- **Description**: EvaluateStage.run 直接把 this.enabledDimensions 当数组使用并调用 `.filter`；调用方若传入非数组（如字符串）会触发 TypeError，导致评估失败。
- **Suggestion**: 在构造或 run 中校验 dimensions 是否为字符串数组，例如：`const evaluatorNames = Array.isArray(this.enabledDimensions) ? this.enabledDimensions : [...this._evaluators.keys()];` 并过滤非字符串项。
```
const evaluatorNames = this.enabledDimensions
      ?? [...this._evaluators.keys()];
```

---

