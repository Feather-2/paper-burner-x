# Audit History - search-docs

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] timeout-handling
*Archived: 2026-01-20T00:13:20.403Z*

- **File**: js/agents/stages/deepsearch/tools/search-docs/handler.js:254
- **Description**: 外部 retriever 搜索路径没有强制超时控制，retriever.search 若卡住会导致整个 handler 挂起，熔断器不会主动中止执行。
- **Suggestion**: 为外部检索增加超时/中止机制（如 AbortSignal.timeout 或 Promise.race），并将 timeoutMs 透传给 retriever；必要时新增 retrieverTimeoutMs 参数。
```
const raw = await breaker.execute(async () => retriever.search(query, { sources: targetSources, limit: effectiveLimit }));
```

### [RESOLVED] input-validation
*Archived: 2026-01-20T00:13:20.403Z*

- **File**: js/agents/stages/deepsearch/tools/search-docs/handler.js:169
- **Description**: query 仅做类型/真值校验，未限制长度或空白内容；sources 数组元素也未校验为非空字符串，输入验证不够严格，可能导致异常查询或资源消耗。
- **Suggestion**: 对 query 做 trim/长度上限校验，对 sources 做元素类型校验与数量限制，必要时过滤非字符串或空字符串。
```
if (!query || typeof query !== "string") { return { success: false, error: "query is required" }; }
```

---

## Archived: 2026-01-18

### [RESOLVED] 未验证的输入
*Archived: 2026-01-18T21:32:50.268Z*

- **File**: js/agents/stages/deepsearch/tools/search-docs/handler.js:122
- **Description**: args.limit 与 args.semanticTimeoutMs 未做类型/边界校验，非数值或过大值可能导致 poolLimit 计算为 NaN 或引发过度搜索/超时。
- **Suggestion**: 对 limit/semanticTimeoutMs 做 Number.isFinite 校验并设置合理范围（如 limit 1..100、timeout 上限），无效值回退默认值。
```
const { query, sources, limit = 10, gapId, semanticTimeoutMs } = args;

const mmr = resolveMmrSettings(args, limit);
const effectiveLimit = mmr.enabled ? mmr.poolLimit : limit;
```

### [RESOLVED] 错误处理
*Archived: 2026-01-18T21:32:50.268Z*

- **File**: js/agents/stages/deepsearch/tools/search-docs/handler.js:75
- **Description**: resolveEmbeddingService 中 catch 直接忽略异常，缓存/配置异常被静默吞掉，排障困难且可能隐藏真实错误。
- **Suggestion**: 记录告警或使用带 cause 的自定义错误重新抛出；若必须忽略，至少在 debug 日志中说明原因。
```
try {
  const st = cached.getStatus();
  if (st?.endpoint && (st.endpoint === cfg.endpoint || st.endpoint === cfg.url)) return cached;
} catch {
  // ignore
}
```

### [RESOLVED] JSDoc 规范
*Archived: 2026-01-18T21:32:50.268Z*

- **File**: js/agents/stages/deepsearch/tools/search-docs/handler.js:36
- **Description**: applyMmrToResults 使用 any 类型，违反 JSDoc 禁止 any 的约定，类型信息缺失。
- **Suggestion**: 定义 SearchHit 等 @typedef，替换 any 为具体类型。
```
/**
 * @param {any[]} results
 * @param {ApplyMmrOptions=} options
 * @returns {any[]}
 */
```

### [RESOLVED] JSDoc 规范
*Archived: 2026-01-18T21:32:50.268Z*

- **File**: js/agents/stages/deepsearch/tools/search-docs/handler.js:111
- **Description**: 导出 API handler 缺少 @returns（及必要的 @throws）说明，不符合 public API 需要完整 JSDoc 的约定。
- **Suggestion**: 补充 @returns {Promise<...>} 返回结构描述，并按需要补充 @throws。
```
/**
 * @param {Object} args
 * @param {string} args.query - 搜索查询
 * @param {string[]} [args.sources] - 限定的文档 ID 列表
 * @param {number} [args.limit=10] - 返回数量限制
 * @param {string} [args.gapId] - 关联的缺口 ID
 * @param {number} [args.semanticTimeoutMs] - 语义检索超时（ms）
 * @param {Object} context - { state, emit, retriever, discoveryManager }
 */
export async function handler(args, context) {
```

---

