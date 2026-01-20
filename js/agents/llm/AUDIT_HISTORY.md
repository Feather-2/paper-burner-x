# Audit History - llm

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] SSRF / API key exfil
*Archived: 2026-01-19T23:42:19.625Z*

- **File**: js/agents/llm/whisper-provider.js:141
- **Description**: openaiWhisperAdapter 使用 opts.baseUrl 直接拼接 endpoint，并携带 Authorization header。若 baseUrl 可被用户控制，存在 SSRF 与 API key 外泄风险。
- **Suggestion**: 限制 baseUrl 为受信域名（https + allowlist），或在构建/配置阶段锁定；对来自用户输入/存储的 baseUrl 做验证与拒绝策略。
```
const baseUrl = opts.baseUrl || "https://api.openai.com";
const endpoint = `${baseUrl.replace(/\/+$/, "")}/v1/audio/transcriptions`;
headers: { Authorization: `Bearer ${apiKey}` },
```

---

## Archived: 2026-01-19

### [RESOLVED] Error handling
*Archived: 2026-01-19T23:41:46.308Z*

- **File**: js/agents/llm/internal/call-executor.js:177
- **Description**: 多处空 catch/静默 catch 会吞掉异常，违反“异常需记录或重新抛出”约定，可能掩盖遥测/性能路由异常，降低可观测性。
- **Suggestion**: 保留 best-effort 行为但至少通过 router/logger 记录 debug 警告，或封装为可监控的错误计数；避免空 catch，必要时附带上下文并继续执行。
```
try {
  getGlobalTokenTracker().record({
    model: entry.id,
    provider: entry.provider,
    usage,
    promptTokens: resp.usage?.promptTokens || resp.usage?.prompt_tokens || 0,
    completionTokens: resp.usage?.completionTokens || resp.usage?.completion_tokens || 0,
    latencyMs,
    success: true,
  });
} catch {
  // ignore tracker errors
}
```

---

## Archived: 2026-01-19

### [RESOLVED] SSRF / API key exfil
*Archived: 2026-01-19T23:41:42.766Z*

- **File**: js/agents/llm/image-provider.js:245
- **Description**: ImageProvider 允许从 opts.baseUrl 读取自定义 API 基础地址，并在请求中携带 API key（Gemini 为 query 参数、OpenAI 为 Authorization header）。若 baseUrl 可被用户控制（含 localStorage 配置），可将请求导向任意主机并外泄 key 或触发 SSRF。
- **Suggestion**: 对 baseUrl 做 allowlist 校验（仅允许官方域名/https），或将自定义 baseUrl 标记为受信配置并在 UI/配置层限制来源；必要时阻止私网/IP 段，并避免在 URL 中传递密钥。
```
const baseUrl = sanitizeBaseUrl(opts.baseUrl, "https://api.openai.com");
const endpoint = `${baseUrl}/v1/images/generations`;
headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
```

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

