# Audit History - design

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] browser-compat
*Archived: 2026-01-19T20:51:50.207Z*

- **File**: js/agents/stages/design/subagents/slide-agent.js:32
- **Description**: Browser-first 模块仍动态引入 node:fs/node:path，部分 bundler 仍可能在浏览器构建时报错。
- **Suggestion**: 确保构建时 externalize node: 模块或拆分 Node-only 入口并提供浏览器 stub。
```
const fsMod = await import(/* webpackIgnore: true */ "node:fs");
```

---

## Archived: 2026-01-19

### [RESOLVED] error-info-leak
*Archived: 2026-01-19T20:51:36.568Z*

- **File**: js/agents/stages/design/generators/batch-generator.js:624
- **Description**: 事件总线 payload 包含错误堆栈，前端或日志系统可能直接展示堆栈信息。
- **Suggestion**: emit 仅传递 message/code；堆栈写到 logger 或加 debug gate。
```
error: { message: errMsg, stack: errStack }
```

---

## Archived: 2026-01-19

### [RESOLVED] error-handling
*Archived: 2026-01-19T20:51:24.151Z*

- **File**: js/agents/stages/design/internal/design-blackboard.js:320
- **Description**: 多个空 catch 块吞掉异常，可能掩盖 MemoryStore/StateEngine 同步失败，影响状态回滚与排障。
- **Suggestion**: 至少记录 debug/warn 日志或上报可观测事件，避免静默失败。
```
} catch { /* intentional */ }
```

---

## Archived: 2026-01-19

### [RESOLVED] unsafe-deserialization
*Archived: 2026-01-19T20:51:19.790Z*

- **File**: js/agents/stages/design/edit-mode/edit-loop.js:39
- **Description**: LLM 返回值直接 JSON.parse，缺少长度/结构校验，属于未验证外部数据反序列化，可能导致资源消耗或异常结构注入。
- **Suggestion**: 限制最大长度与字段深度，解析后做 schema 校验（operations 数组、tool/params 类型），并拒绝额外字段或超大输入。
```
return JSON.parse(value);
```

---

## Archived: 2026-01-19

### [RESOLVED] error-info-leak
*Archived: 2026-01-19T20:50:55.634Z*

- **File**: js/agents/stages/design/subagents/slide-agent.js:303
- **Description**: 失败返回值包含 stack/cause，若上层直接透传给 UI 或日志，会泄露内部实现细节与路径。
- **Suggestion**: 对外仅返回友好 message/code；stack/cause 仅写内部日志或在 debug 开关下返回。
```
const stack = err instanceof Error ? err.stack : undefined;
```

---

## Archived: 2026-01-19

### [RESOLVED] prototype-pollution
*Archived: 2026-01-19T20:50:50.626Z*

- **File**: js/agents/stages/design/generators/design-system-generator.js:27
- **Description**: deepMerge 将 userPreferences.designSystemOverrides 的键直接写入普通对象，未过滤 __proto__/constructor/prototype，存在原型污染风险（覆盖 UI 传入 overrides 时尤为明显）。
- **Suggestion**: 在合并前过滤危险键或使用 null-prototype 容器（Object.create(null)），并在 overrides 边界做白名单校验。
```
out[k] = isPlainObject(bv) ? deepMerge({}, bv) : Array.isArray(bv) ? bv.slice() : bv;
```

---

## Archived: 2026-01-18

### [RESOLVED] async-error-handling
*Archived: 2026-01-18T22:04:08.728Z*

- **File**: js/agents/stages/design/edit-mode/edit-loop.js:300
- **Description**: _handleChatMessage 在进入 PROCESSING 后调用 _captureCanvasContext/_interpretIntent 未被 try/catch 包裹；若 modelRouter.chat 或画布捕获失败，会导致会话状态无法回到 AWAITING_INPUT，编辑流程可能卡死。
- **Suggestion**: 将 _captureCanvasContext/_interpretIntent/clarification send 包裹在 try/catch/finally 中，并在 finally 强制恢复 AWAITING_INPUT；失败时返回可见错误信息。
```
this._transitionSession(session, EditSessionStatus.PROCESSING, { state, emit, onSessionTransition });

const { currentDsl, screenshot } = await this._captureCanvasContext({ state, canvasBridge, toolExecutor });
const intent = await this._interpretIntent({ ... });
```

### [RESOLVED] browser-compat
*Archived: 2026-01-18T22:04:08.728Z*

- **File**: js/agents/stages/design/model.js:16
- **Description**: model.js 读取 globalThis.process/process.env 控制超时与调试开关，属于 Node-only API；浏览器环境可能被注入 polyfill 或直接缺失，违背无 Node-only API 的要求。
- **Suggestion**: 将配置改为由 stageApi/options 注入或使用 import.meta.env，并把 Node 环境读取放到独立适配层。
```
const process = /** @type {any} */ (globalThis).process;
const env = typeof process !== "undefined" ? process.env : null;
```

### [RESOLVED] browser-compat
*Archived: 2026-01-18T22:04:08.728Z*

- **File**: js/agents/stages/design/runtime/screenshot-stitcher.js:20
- **Description**: runtime/screenshot-stitcher.js 通过动态 import 引入 Node-only 的 canvas 包；部分打包器会把它引入浏览器构建或直接报错，影响纯浏览器兼容性。
- **Suggestion**: 将 Node 版实现拆分到独立入口/条件导出，浏览器构建仅保留 DOM 实现；必要时通过 bundler alias/external 配置隔离。
```
const mod = await import(/* webpackIgnore: true */ "canvas");
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T22:04:08.728Z*

- **File**: js/agents/stages/design/shared/design-utils.js:16
- **Description**: shared/design-utils.js 中多个导出函数仅有描述性注释，缺少 @param/@returns 类型标注（如 clamp/nowMs/parseSections/joinSections/extractElements），不符合项目 JSDoc 约定。
- **Suggestion**: 为导出函数补齐 @param/@returns 类型标注，确保 checkJs 与类型提示一致。
```
/**
 * Safely clamps a number between min and max.
 */
export function clamp(v, min, max, fallback = min) {
```

### [RESOLVED] event-naming
*Archived: 2026-01-18T22:04:08.728Z*

- **File**: js/agents/stages/design/generators/batch-generator.js:688
- **Description**: 事件名使用 design.batch.started/design.slide.started 等点分格式，未遵循 domain:action 约定，可能导致监听端不兼容。
- **Suggestion**: 将事件名调整为 design:batch.started / design:slide.started 等 domain:action 格式，必要时保留旧事件名做兼容发射。
```
safeEmit(emit, "design.batch.started", "started", { batchIndex, slideIndexes, styleLock: batchIndex > 0 });
```

---

