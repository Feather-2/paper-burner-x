# Audit History - api

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] 错误处理
*Archived: 2026-01-18T21:42:17.647Z*

- **File**: `js/agents/runtime/api/stage-api-factory.js`:125
- **Description**: 多个 catch 块为空或仅返回 null，异常被吞掉，违背“异常需记录或重新抛出”的约定，可能隐藏配置/注入失败（同类情况在容器解析与回压/遥测处多处出现）。
- **Suggestion**: 至少记录一次可观测日志（logger.warn/debug）或带上下文重新抛出；若必须忽略，注明原因并集中到统一的容错封装。
```
  if (typeof c.get === "function") {
    try {
      const candidate = c.get("traceContext");
      return isTraceContextLike(candidate) ? candidate : null;
    } catch {
      return null;
    }
  }
```

### [RESOLVED] JSDoc
*Archived: 2026-01-18T21:42:17.647Z*

- **File**: `js/agents/runtime/api/stage-api-factory.js`:618
- **Description**: 公有 API 的 JSDoc 缺少参数/返回值描述（规则要求 @param/@returns 必须含描述），影响文档与类型提示；createBaseApi/createDeepSearchApi/createDesignApi 等均存在。
- **Suggestion**: 为 @param/@returns 补充简短描述，必要时补 @throws；保持公共方法完整 JSDoc。
```
/**
   * 创建基础 StageApi
   * @param {Record<string, any>} [overrides]
   * @returns {any}
   */
```

### [RESOLVED] JSDoc/可见性
*Archived: 2026-01-18T21:42:17.647Z*

- **File**: `js/agents/runtime/api/stage-api-factory.js`:284
- **Description**: 多处内部辅助函数缺少 `/** @private */` 标记或 JSDoc（如 isMessageBusLike/resolveMessageBusFromContainer），与项目约定不符。
- **Suggestion**: 为内部辅助函数补 `/** @private */`，必要时补 @param/@returns 描述，明确可见性与用途。
```
function isMessageBusLike(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.request === "function" &&
    typeof value.handle === "function"
  );
}
```

### [RESOLVED] 代码风格
*Archived: 2026-01-18T21:42:17.647Z*

- **File**: `js/agents/runtime/api/stage-api-factory.js`:394
- **Description**: `ensureAiApiServiceTokenTracking` 超过 50 行，违反函数长度约定，且包含多层逻辑（breaker/记录/异常处理）。
- **Suggestion**: 拆分为更小的 helper（例如 breaker 构造、成功/失败记录），降低复杂度并满足长度约束。
```
function ensureAiApiServiceTokenTracking(aiApiService) {
  if (!aiApiService || typeof aiApiService !== "object") return;
  const originalChat = aiApiService.chat;
  if (typeof originalChat !== "function") return;
  const registryLike =
    aiApiService?.circuitBreakerRegistry && typeof aiApiService.circuitBreakerRegistry.get === "function"
      ? aiApiService.circuitBreakerRegistry
      : null;

```

---

