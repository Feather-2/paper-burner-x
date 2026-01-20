# Audit History - manifest

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] JSDoc incomplete
*Archived: 2026-01-20T00:23:05.131Z*

- **File**: `js/agents/runtime/core/manifest/manifest.js`:456
- **Description**: ManifestRegistry 的公开方法缺少 @param/@returns 等完整 JSDoc，违反 public API 规范。
- **Suggestion**: 为 ManifestRegistry 的公开方法补充完整 JSDoc（@param/@returns/@throws），并为 getter 说明返回类型。
```
/**
 * 注册 Manifest
 */
  register(manifest) {
```

### [RESOLVED] JSDoc private tag missing
*Archived: 2026-01-20T00:23:05.131Z*

- **File**: `js/agents/runtime/core/manifest/manifest.js`:400
- **Description**: inferPermissions / inferSkillPermissions 为内部函数但未标记 @private，违反私有函数标注规范。
- **Suggestion**: 在这两个函数的注释中补充 `@private` 标记，或新增独立的 `/** @private */` 说明。
```
/**
 * 推断 Tool 所需权限
 */
function inferPermissions(definition) {
```

---

## Archived: 2026-01-18

### [RESOLVED] prototype_pollution
*Archived: 2026-01-18T19:34:42.533Z*

- **File**: js/agents/runtime/manifest/manifest.js:221
- **Description**: normalizeParameterSchema 将 parameters 的键直接写入普通对象，若参数可被外部输入控制，"__proto__"/"constructor"/"prototype" 等键可导致原型污染并影响运行时行为。
- **Suggestion**: 使用 Object.create(null) 作为容器并显式拒绝危险键，或在写入前进行键白名单/黑名单校验。
```
const properties = {};
const required = [];

for (const [key, value] of Object.entries(parameters)) {
  if (typeof value === "string") {
    const isRequired = value.includes("必需") || value.includes("required");
    properties[key] = {
```

### [RESOLVED] input_validation
*Archived: 2026-01-18T19:34:42.533Z*

- **File**: js/agents/runtime/manifest/manifest.js:215
- **Description**: 当 parameters 看似是 JSON Schema 时直接透传，没有对 schema 形状与类型做验证，恶意或畸形 schema 可能绕过归一化并进入后续流程。
- **Suggestion**: 增加 schema 结构校验与深层清洗，至少验证 type/properties/required 的类型和边界。
```
if (parameters.type === "object" || parameters.properties) {
  return parameters;
}
```

### [RESOLVED] error_handling
*Archived: 2026-01-18T19:34:42.533Z*

- **File**: js/agents/runtime/manifest/manifest.js:80
- **Description**: 公共 API 直接抛出通用 Error 字符串，无法区分错误类型，不符合“使用自定义 Error 类”约定。
- **Suggestion**: 定义 ManifestValidationError 等自定义错误类，并在抛出时附带可读的用户提示。
```
if (!name) throw new Error("Manifest requires name");
if (!description) throw new Error("Manifest requires description");
```

### [RESOLVED] jsdoc_incomplete
*Archived: 2026-01-18T19:34:42.533Z*

- **File**: js/agents/runtime/manifest/manifest.js:62
- **Description**: 多个公开函数的 @param/@returns 缺少描述，内部 helper 也未标注 @private，不符合 JSDoc 规范要求。
- **Suggestion**: 补充 @param/@returns 描述文本，并为非导出函数添加 /** @private */ 标注。
```
/**
 * 创建 Tool Manifest
 * @param {Object} options
 * @returns {ManifestSchema}
 */
```

### [RESOLVED] test_pseudotest
*Archived: 2026-01-18T19:34:42.533Z*

- **File**: tests/agents/runtime/manifest.test.js:40
- **Description**: 异常断言未调用 .toThrow(...)，导致测试不会失败（伪测试）；同类问题还出现在 manifest registry 的异常测试中。
- **Suggestion**: 改为 expect(() => createToolManifest({ description: "test" })).toThrow(/requires name/); 并修复其它同类断言。
```
it("should throw on missing name", () => {
  expect(() => {
    createToolManifest({ description: "test" }).toThrow();
  }, /requires name/);
});
```

---

