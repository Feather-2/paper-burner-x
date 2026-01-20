# Audit History - checkpoints

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] error-handling
*Archived: 2026-01-20T00:23:11.840Z*

- **File**: js/agents/plugins/checkpoints/agent-checkpoint-store.js:92
- **Description**: makeCheckpointId 捕获 makeSecureTimestampedId 的异常后没有记录或转抛，违背“不要吞掉异常”约定且会隐藏 ID 生成失败。
- **Suggestion**: 在回退生成之前记录原始错误或重新抛出，并考虑使用自定义 Error 便于区分类型。
```
function makeCheckpointId() {
  try {
    return makeSecureTimestampedId("ckpt");
  } catch {
    const ts = Date.now().toString(36);

```

### [RESOLVED] jsdoc
*Archived: 2026-01-20T00:23:11.840Z*

- **File**: js/agents/plugins/checkpoints/agent-checkpoint-store.js:254
- **Description**: 公开 API 的 @returns 缺少描述（listCheckpoints/saveCheckpoint），与 JSDoc 要求不符。
- **Suggestion**: 为 @returns 添加简短返回描述（如“返回检查点元数据列表”），并同步到 saveCheckpoint。
```
/**
 * 列出指定运行的所有检查点
 * @param {object} [options] - 选项
 * @param {string} [options.runId] - 运行 ID (可选，默认使用实例 runId)
 * @returns {Promise<Array<{checkpointId: string, ts: string, step?: number, iteration?: number, metadata?: object}>>}
 */
```

### [RESOLVED] jsdoc
*Archived: 2026-01-20T00:23:11.840Z*

- **File**: js/agents/plugins/checkpoints/agent-checkpoint-store.js:65
- **Description**: 多个内部 helper 未标记 /** @private */（示例 buildCheckpointDir），不符合私有函数标注约定。
- **Suggestion**: 给内部 helper 添加 /** @private */ 或封装到类内以明确可见性。
```
function buildCheckpointDir(runId) {
  const safeRunId = safeSegment(runId, "run");
  return `.agents/runs/${safeRunId}/checkpoints`;
}
```

### [RESOLVED] style
*Archived: 2026-01-20T00:23:11.840Z*

- **File**: js/agents/plugins/checkpoints/agent-checkpoint-store.js:136
- **Description**: JSON 解析大小阈值使用魔法数字（2_000_000/5_000_000），违反避免魔法数字约定。
- **Suggestion**: 提取为命名常量（如 INDEX_JSON_MAX_CHARS / CHECKPOINT_JSON_MAX_CHARS）。
```
const parsed = safeJsonParse(raw, { maxChars: 2_000_000 });
```

---

