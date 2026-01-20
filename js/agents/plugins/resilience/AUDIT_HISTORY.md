# Audit History - resilience

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] JSDoc 覆盖不足
*Archived: 2026-01-20T00:26:52.975Z*

- **File**: js/agents/plugins/resilience/degradation-matrix.js:363
- **Description**: DegradationMatrix 的公开方法缺少完整 JSDoc（@param 描述/@returns），与项目 API 文档规范不符。
- **Suggestion**: 为公开方法补全 JSDoc（含 @param 描述与 @returns），并为内部方法补充 @private 标记。
```
  /**
   * 检查功能是否可用
   * @param {string} feature
   */
  isFeatureEnabled(feature) {
```

### [RESOLVED] 事件命名规范
*Archived: 2026-01-20T00:26:52.975Z*

- **File**: js/agents/plugins/resilience/retry.js:62
- **Description**: 事件名使用了 'resilience.retry' / 'resilience.exhausted'，不符合约定的 domain:action 格式，可能导致订阅约定不一致。
- **Suggestion**: 改为 `resilience:retry` 和 `resilience:exhausted` 并同步更新监听方。
```
          ctx.events.emit('resilience.retry', {
            service: context.service,
            method: context.method,
            attempt: attempts,
          });
```

### [RESOLVED] 无效配置
*Archived: 2026-01-20T00:26:52.975Z*

- **File**: js/agents/plugins/resilience/retry.js:20
- **Description**: `maxDelay` 在 defaultConfig 中声明但未传入重试实现，当前配置无效且容易误导使用者。
- **Suggestion**: 删除 `maxDelay` 或扩展 `createRetryProxy` 支持延迟上限并传入该配置。
```
  defaultConfig: {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    retryableErrors: ['ETIMEDOUT', 'ECONNRESET', 'RATE_LIMIT'],
  },
```

---

