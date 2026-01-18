# Audit History - llm

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] convention
*Archived: 2026-01-18T21:40:20.238Z*

- **File**: js/agents/llm/model-router.js:638
- **Description**: 事件名使用点号，不符合 domain:action 约定（circuit.stateChange、model.unhealthy、model.failover）。
- **Suggestion**: 改为 `circuit:stateChange`、`model:unhealthy`、`model:failover` 并同步更新监听方与测试。
```
this.emit("circuit.stateChange", event);
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:40:20.238Z*

- **File**: js/agents/llm/provider.js:5
- **Description**: 导出函数缺少 @param/@returns 类型注解（normalizeModelTags/assertModelEntry/assertUsageConfig/assertChatMessages/assertChatResponse/assertProvider）。
- **Suggestion**: 为每个导出函数补充 JSDoc，包含参数类型与返回类型。
```
export function normalizeModelTags(tags) {
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:40:20.238Z*

- **File**: js/agents/llm/constants.js:32
- **Description**: 导出校验函数缺少 @param/@returns 类型注解（isValidModelUsage/isValidMessageRole/isValidModelHealth/isValidRouterStrategy）。
- **Suggestion**: 为校验函数补齐 @param {unknown} value 与 @returns {boolean}。
```
export function isValidModelUsage(value) {
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:40:20.238Z*

- **File**: js/agents/llm/rate-limit.js:48
- **Description**: 限流配置辅助函数缺少 @param/@returns 类型注解（normalizeRateLimitConfig/loadRateLimitConfig）。
- **Suggestion**: 补充输入类型与返回配置结构的 JSDoc。
```
export function normalizeRateLimitConfig(input, fallback = {}) {
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:40:20.238Z*

- **File**: js/agents/llm/image-provider.js:391
- **Description**: 工厂函数缺少 @param/@returns 类型注解（createImageProvider/createImageProviderFromConfig）。
- **Suggestion**: 为工厂函数补充参数与返回 ImageProvider 的 JSDoc。
```
export function createImageProvider(config) {
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:40:20.238Z*

- **File**: js/agents/llm/whisper-provider.js:309
- **Description**: 导出工厂与工具函数缺少 @param/@returns 类型注解（createWhisperProviderFromConfig/segmentsToLrc/segmentsToSrt）。
- **Suggestion**: 补充参数类型（storage/keyLoader/segments）与返回类型说明。
```
export function createWhisperProviderFromConfig({ storage, keyLoader, storageKey = "whisperProviderConfig" } = {}) {
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:40:20.238Z*

- **File**: js/agents/llm/ppt-model-bridge.js:134
- **Description**: 多处导出函数缺少 @param/@returns（getPptModelTags/getPptRolePriority/getPptAudioConfig/buildPptUsageConfigForModelRouter/createPptConfiguredChat/createPptAwareAiApiService/getPptConfigSummary）。
- **Suggestion**: 为各导出函数补齐参数与返回类型，尤其是返回结构/可能为 null 的情况。
```
export function getPptModelTags() {
```

---

