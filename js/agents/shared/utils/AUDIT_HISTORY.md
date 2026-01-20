# Audit History - utils

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] browser-compatibility
*Archived: 2026-01-19T23:42:04.251Z*

- **File**: js/agents/shared/utils/file-watcher.js:68
- **Description**: 动态导入 node:fs 属于 Node-only API，若被浏览器打包引用可能导致构建/运行失败。
- **Suggestion**: 在显式 Node 环境下才导入，或拆分为 Node 专用入口以保持浏览器构建纯净。
```
const mod = await import(/* @vite-ignore */ fsSpecifier);
```

---

## Archived: 2026-01-19

### [RESOLVED] unsafe-deserialization
*Archived: 2026-01-19T23:41:59.907Z*

- **File**: js/agents/shared/utils/response-limits.js:140
- **Description**: readJsonWithLimit 对外部响应文本直接 JSON.parse，未验证结构，可能引入意外对象形态。
- **Suggestion**: 在返回前进行 schema/shape 校验，或明确仅用于可信响应并在调用处做强校验。
```
return JSON.parse(text);
```

---

## Archived: 2026-01-19

### [RESOLVED] input-validation
*Archived: 2026-01-19T23:41:45.655Z*

- **File**: js/agents/shared/utils/robust-json.js:177
- **Description**: robustParseJsonWithValidation 在验证失败/抛错时仍返回解析结果，名义上的验证未生效。
- **Suggestion**: 验证失败时返回 fallback/抛错，或重命名函数以避免误导调用方。
```
if (validator(result.data)) return result.data; ... return result.ok ? result.data : fallback;
```

---

## Archived: 2026-01-19

### [RESOLVED] unsafe-deserialization
*Archived: 2026-01-19T23:41:41.252Z*

- **File**: js/agents/shared/utils/stage-api.js:259
- **Description**: LLM/tool 输出直接 JSON.parse，缺少结构验证/大小约束，异常或意外结构可能进入下游逻辑。
- **Suggestion**: 对解析结果做 schema/shape 校验（如 schema-validator 或显式字段检查），并考虑在解析前设置大小限制。
```
return JSON.parse(content);
```

---

## Archived: 2026-01-18

### [RESOLVED] browser-compat
*Archived: 2026-01-18T21:24:58.184Z*

- **File**: js/agents/shared/utils/file-watcher.js:62
- **Description**: 动态导入 `node:fs` 并依赖 fs.watch/fs.stat，违反“无 Node-only API”的浏览器兼容要求；在浏览器构建中可能导致打包失败或运行时异常。
- **Suggestion**: 将 Node 专用实现拆分为 Node-only 入口，或在浏览器构建中通过显式环境判断/注入 vfs 来避免解析 `node:fs`。
```
const fsSpecifier = "node:fs";
```

### [RESOLVED] convention
*Archived: 2026-01-18T21:24:58.184Z*

- **File**: js/agents/shared/utils/logger.js:39
- **Description**: logger emit 的事件名使用点分隔（`${actorName}.log.${level}`），不符合约定的 `domain:action` 格式，可能导致事件消费方不一致。
- **Suggestion**: 改为 `domain:action` 格式（例如 `${actorName}:log`，level 放在 payload 中，或 `${actorName}:log:${level}`）。
```
emitFn?.(`${actorName}.log.${level}`, payload, { status: level === "error" ? "failed" : "info" });
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:24:58.184Z*

- **File**: js/agents/shared/utils/json-candidate.js:15
- **Description**: 导出的 `stripThinkingTags` 缺少 JSDoc `@param`/`@returns` 类型注解，违反项目 JSDoc 规范。
- **Suggestion**: 补充 JSDoc：`@param {string} text`、`@returns {string}`。
```
export function stripThinkingTags(text) {
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:24:58.184Z*

- **File**: js/agents/shared/utils/error-classifier.js:81
- **Description**: 导出的 `classifyDeepSearchError`（以及同文件其他导出）缺少 JSDoc 类型注解，JSDoc 覆盖不完整。
- **Suggestion**: 为该函数添加 `@param {unknown} err` 和明确的 `@returns` 结构说明，并补齐同文件其他导出。
```
export function classifyDeepSearchError(err) {
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:24:58.184Z*

- **File**: js/agents/shared/utils/budget.js:148
- **Description**: `createBudgetManager` 作为导出函数缺少 `@param`/`@returns` 类型注解。
- **Suggestion**: 补充 JSDoc 描述 `userConfig` 结构与返回 `BudgetManager` 实例。
```
export function createBudgetManager(userConfig = {}) {
```

---

