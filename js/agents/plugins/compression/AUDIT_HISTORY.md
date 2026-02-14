# Audit History - compression

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] input-validation
*Archived: 2026-01-20T00:16:58.191Z*

- **File**: js/agents/plugins/compression/impl/compression-async.js:275
- **Description**: compressSessionHistoryAsync 未校验 messages 是否为数组，直接访问 messages.length 并传入 sync 压缩，非数组会抛错。
- **Suggestion**: 在入口处使用 Array.isArray(messages) 校验并抛出 TypeError 或返回空结果，避免非数组导致崩溃。
```
if (!rpc || messages.length < threshold) {
```

### [RESOLVED] error-handling
*Archived: 2026-01-20T00:16:58.191Z*

- **File**: js/agents/plugins/compression/watchdog.js:83
- **Description**: cleanup 中的空 catch 吞掉 unsubscribe 异常，违背“不要吞掉异常”的要求，可能掩盖资源清理失败。
- **Suggestion**: 记录 warn 日志或重新抛出，同时确保后续清理继续执行。
```
try { unsubscribe(); } catch {}
```

### [RESOLVED] error-handling
*Archived: 2026-01-20T00:16:58.191Z*

- **File**: js/agents/plugins/compression/impl/watchdog.js:88
- **Description**: BehaviorFingerprint 初始化/分析失败被静默忽略，可能隐藏逻辑震荡检测失效原因。
- **Suggestion**: 至少记录 warning 级日志或作为诊断事件上报，避免静默失败。
```
try { this._behaviorFingerprint = new BehaviorFingerprint(cfg); } catch { this._behaviorFingerprint = null; }
```

### [RESOLVED] error-handling
*Archived: 2026-01-20T00:16:58.191Z*

- **File**: js/agents/plugins/compression/impl/compression-async.js:33
- **Description**: Worker 创建/终止异常被吞掉，导致 Worker 不可用时缺少诊断信息。
- **Suggestion**: 在 catch 中使用 logger.warn 记录异常，再返回 null。
```
} catch { return null; }
```

### [RESOLVED] jsdoc-any
*Archived: 2026-01-20T00:16:58.191Z*

- **File**: js/agents/plugins/compression/impl/cicada-compressor.js:12
- **Description**: 公开 JSDoc 中使用 {any} / Record<string, any>，违反“禁止 any”约定，弱化类型契约。
- **Suggestion**: 为 modelRouter/archive/eventBus 定义明确的 @typedef，并替换 any。
```
@property {any} [modelRouter]
```

### [RESOLVED] event-naming
*Archived: 2026-01-20T00:16:58.191Z*

- **File**: js/agents/plugins/compression/cicada.js:86
- **Description**: 事件名使用点号（compression.done/compression.warning 等），不符合 domain:action 约定。
- **Suggestion**: 统一改为 compression:done / compression:warning / watchdog:threshold:exceeded 并同步更新监听与文档。
```
ctx.events.emit('compression.done', {
```

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

