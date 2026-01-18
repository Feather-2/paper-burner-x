# Audit History - resilience

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] jsdoc-compliance
*Archived: 2026-01-18T20:41:22.898Z*

- **File**: `js/agents/runtime/resilience/degradation-matrix.js:107`:107
- **Description**: 多处 public API JSDoc 缺少参数描述/返回值说明，不符合项目 JSDoc 规范。
- **Suggestion**: 补全 @param 描述与 @returns，并注明对象参数结构，保证 public API 文档完整。
```
/**
   * 检查功能是否可用
   * @param {OperationLevelValue} level
   * @param {string} feature
   */
```

---

## Archived: 2026-01-18

### [RESOLVED] input-validation
*Archived: 2026-01-18T20:41:02.538Z*

- **File**: `js/agents/runtime/resilience/degradation-matrix.js:239`:239
- **Description**: recordRequest 未验证 latencyMs/isError，NaN/负值/非布尔输入会污染统计并触发误降级。
- **Suggestion**: 校验 latencyMs 为有限非负数、isError 为 boolean；非法值应丢弃或归一化（例如 clamp/默认值）。
```
recordRequest({ latencyMs = 0, isError = false } = {}) {
    this._metrics.recordRequest(latencyMs, isError);
    this._evaluate();
  }
```

---

## Archived: 2026-01-18

### [RESOLVED] hook-integrity
*Archived: 2026-01-18T20:40:23.414Z*

- **File**: `js/agents/runtime/resilience/degradation-matrix.js:325`:325
- **Description**: onLevelChange 回调未做异常隔离，回调抛错会中断 recordRequest/_evaluate 主流程，违反 Hook 链完整性要求。
- **Suggestion**: 用 try/catch 包裹回调并通过 logger 记录异常，保证主流程继续运行；必要时通过独立错误事件/遥测上报。
```
if (this._onLevelChange) {
      this._onLevelChange({ from: oldLevel, to: newLevel, trigger });
    }
```

---

