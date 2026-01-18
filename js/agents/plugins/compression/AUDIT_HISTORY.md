# Audit History - compression

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] error-handling-empty-catch
*Archived: 2026-01-18T21:07:12.266Z*

- **File**: js/agents/plugins/compression/watchdog.js:30
- **Description**: 清理旧资源时使用空 catch 吞掉异常，可能隐藏清理失败并导致重复 interval/监听器。
- **Suggestion**: 记录错误并保留上下文（如带 cause 的 Error），或至少输出日志以便定位清理失败。
```
if (typeof ctx._watchdogCleanup === 'function') {
      try { ctx._watchdogCleanup(); } catch {}
    }
```

### [RESOLVED] async-unhandled-rejection
*Archived: 2026-01-18T21:07:12.266Z*

- **File**: js/agents/plugins/compression/watchdog.js:92
- **Description**: 定时/事件触发的 checkHealth 以 fire-and-forget 方式调用，若内部抛错会产生未处理 rejection。
- **Suggestion**: 对调用加 `.catch()` 记录错误，或在 checkHealth 内部统一 try/catch 并上报。
```
intervalId = setInterval(() => {
          void checkHealth();
        }, ctx.config.checkInterval);
```

### [RESOLVED] jsdoc-any-missing-descriptions
*Archived: 2026-01-18T21:07:12.266Z*

- **File**: js/agents/plugins/compression/cicada.js:41
- **Description**: 公共服务 API 的 JSDoc 使用 any 且缺少参数/返回值描述，违反项目 JSDoc 规范。
- **Suggestion**: 为消息、选项与返回结构定义 @typedef，并补充描述；避免 any。
```
 * @param {any[]} messages
 * @param {Record<string, any>} [options]
 * @returns {Promise<any>}
```

### [RESOLVED] magic-number
*Archived: 2026-01-18T21:07:12.266Z*

- **File**: js/agents/plugins/compression/cicada.js:71
- **Description**: 压缩/告警阈值与节流间隔使用硬编码数值（0.8/0.9/1000），不符合“避免魔法数字”约定。
- **Suggestion**: 提取为命名常量（如 SHOULD_COMPRESS_RATIO、WARNING_RATIO、TOKEN_EVENT_THROTTLE_MS）并集中配置。
```
return tokenCount > ctx.config.maxContextTokens * 0.8;
```

---

