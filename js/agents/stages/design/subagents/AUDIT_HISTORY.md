# Audit History - subagents

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] jsdoc-any
*Archived: 2026-01-19T20:50:48.548Z*

- **File**: js/agents/stages/design/subagents/slide-agent.js:24
- **Description**: JSDoc 中使用 any，违反“禁止 any 类型”的规范，且缺少具体类型说明。
- **Suggestion**: 为 payload 定义明确 @typedef（如 Record<string, unknown> 或具体字段类型），并补充参数描述。
```
@typedef {(name: string, event: { actor: string, status: string, payload: any }) => void} EmitFn
```

---

## Archived: 2026-01-19

### [RESOLVED] error-info-leak
*Archived: 2026-01-19T20:50:37.374Z*

- **File**: js/agents/stages/design/subagents/slide-agent.js:303
- **Description**: 失败时将 stack/cause 直接返回给调用方，若结果透出到用户界面会泄露内部路径与实现细节。
- **Suggestion**: 仅返回用户可见的友好错误信息；将堆栈记录到内部日志或在 debug 标志下才附带。
```
const stack = err instanceof Error ? err.stack : undefined;
...
...(stack ? { stack } : {}),
...(cause ? { cause } : {}),
```

---

## Archived: 2026-01-19

### [RESOLVED] timeout-handling
*Archived: 2026-01-19T20:49:53.009Z*

- **File**: js/agents/stages/design/subagents/visual-agent.js:237
- **Description**: 长时间运行的 AI 图像生成缺少显式超时/取消传递，可能导致阶段悬挂或资源占用过长。
- **Suggestion**: 向 imageGenerator.generate 传递 signal/timeout，或在外层增加超时包装并在超时后标记失败与回滚。
```
imageGenerator.generate(..., { emit, runId, policy, budget, concurrency, circuitBreakerRegistry, imageProvider })
```

---

## Archived: 2026-01-19

### [RESOLVED] prototype-pollution
*Archived: 2026-01-19T20:47:39.999Z*

- **File**: js/agents/stages/design/subagents/asset-registry.js:134
- **Description**: export() 里用未约束的 slideId 作为对象键写入，若 slideId 为 __proto__/constructor 等特殊键会污染返回对象原型。
- **Suggestion**: 使用 Object.create(null) 作为 mapping，并过滤 __proto__/constructor/prototype 键，或改为返回数组/Map 的序列化结构。
```
const mapping = {};
for (const [slideId, assetIds] of this.slideAssetMapping.entries()) {
  mapping[slideId] = assetIds.slice();
}
```

---

## Archived: 2026-01-18

### [RESOLVED] security
*Archived: 2026-01-18T22:04:48.884Z*

- **File**: js/agents/stages/design/subagents/slide-agent.js:47
- **Description**: readLinkedFiles 直接读取 slideIntent.linkedFiles 指定路径，若输入不可信可能导致任意文件读取/信息泄露。
- **Suggestion**: 对 linkedFiles 做路径校验/allowlist，并限制到受控根目录；或由上层传入已加载内容而非任意路径。
```
for (const filePath of files) {
  const file = toNonEmptyString(filePath);
  if (!file) continue;
  const raw = await fsPromises.readFile(file, "utf8");
```

### [RESOLVED] compatibility
*Archived: 2026-01-18T22:04:48.884Z*

- **File**: js/agents/stages/design/subagents/slide-agent.js:22
- **Description**: 模块内动态 import node:fs/node:path，即使有 isBrowser 判断，部分打包器仍可能在浏览器构建时报错。
- **Suggestion**: 将 Node-only 逻辑拆到独立模块并用条件导出/运行时注入，避免浏览器构建解析 node:* 依赖。
```
const fsSpecifier = "node:fs";
const pathSpecifier = "node:path";
const fsMod = await import(fsSpecifier);
```

### [RESOLVED] error-handling
*Archived: 2026-01-18T22:04:48.884Z*

- **File**: js/agents/stages/design/subagents/slide-agent.js:278
- **Description**: SlideSubAgent.run 捕获异常后仅返回 message，丢失 stack/cause，上层排查困难。
- **Suggestion**: 返回结构中附带 stack/cause，或在上层统一记录原始 Error。
```
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  this._transition(SlideStatus.FAILED, { slideIntentId, slideIndex, error: msg });
  return {
    slideIntentId,
    slideIndex,
    htmlDsl: "",
    visualSlots: [],
    status: this.state.status,
    source: "error",
    error: msg,
  };
}
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T22:04:48.884Z*

- **File**: js/agents/stages/design/subagents/asset-registry.js:86
- **Description**: AssetRegistry 的公开方法缺少 JSDoc 类型注解（getAsset/linkToSlide/getAssetsForSlide/export/toJSON/fromJSON），不符合 JSDoc 完整性要求。
- **Suggestion**: 为上述公开方法补充 @param/@returns 注解，保持导出 API 类型完整。
```
getAsset(assetId) {
  const id = toNonEmptyString(assetId);
  if (!id) return null;
  return this.byId.get(id) || null;
}
```

### [RESOLVED] dead-code
*Archived: 2026-01-18T22:04:48.884Z*

- **File**: js/agents/stages/design/subagents/visual-agent.js:26
- **Description**: safeNumber 定义后未被使用，属于死代码。
- **Suggestion**: 删除未使用函数，或在需要的地方复用以减少噪音。
```
function safeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
```

---

