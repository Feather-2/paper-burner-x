# Audit History - search-docs

Archived issues from security audits.

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

