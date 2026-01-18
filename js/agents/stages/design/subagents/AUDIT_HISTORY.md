# Audit History - subagents

Archived issues from security audits.

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

