# Audit History - skills

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] 原型污染
*Archived: 2026-01-19T20:46:56.198Z*

- **File**: js/agents/skills/loader.browser.js:154
- **Description**: Browser 端 tags 解析未过滤 key，可能导致原型污染。
- **Suggestion**: 使用 Object.create(null) 存储 tags，并过滤 __proto__/prototype/constructor。
```
const tags = {};
if (parsed.tags) {
  String(parsed.tags)
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const [k, v] = pair.split(":").map((s) => s.trim());
      if (k) tags[k] = v || "";
    });
}
```

---

## Archived: 2026-01-19

### [RESOLVED] 错误处理
*Archived: 2026-01-19T20:46:47.461Z*

- **File**: js/agents/skills/manager.js:86
- **Description**: 远程 provider 的异常被静默吞掉，违反错误处理规范并隐藏故障。
- **Suggestion**: 使用 logger 记录错误或追加到 outcome.errors，避免静默失败。
```
try {
  const remoteSkills = await this.remoteProvider.listSkills();
} catch (err) {
  // ignore remote skills errors (best-effort)
}
```

---

## Archived: 2026-01-19

### [RESOLVED] 原型污染
*Archived: 2026-01-19T20:46:44.396Z*

- **File**: js/agents/skills/loader.node.js:195
- **Description**: tags 解析把用户控制的 key 直接写入普通对象，可能触发原型污染。
- **Suggestion**: 使用 Object.create(null) 作为 tags 容器，并过滤 __proto__/prototype/constructor。
```
const tags = {};
if (parsed.tags) {
  parsed.tags.split(",").forEach(pair => {
    const [k, v] = pair.split(":").map(s => s.trim());
    if (k) tags[k] = v || "";
  });
}
```

---

## Archived: 2026-01-19

### [RESOLVED] 路径穿越
*Archived: 2026-01-19T20:46:26.125Z*

- **File**: js/agents/skills/loader.node.js:456
- **Description**: Node 端 loadSkillFromPath 直接读取传入路径，若入参来自不可信输入会导致任意文件读取。
- **Suggestion**: 校验 filePath 必须位于 repo/user skills 目录内，拒绝绝对路径/..，必要时做白名单限制。
```
export async function loadSkillFromPath(filePath, scope = SkillScope.USER) {
  return parseSkillFile(filePath, scope);
}
```

---

## Archived: 2026-01-19

### [RESOLVED] 原型污染
*Archived: 2026-01-19T20:46:23.322Z*

- **File**: js/agents/skills/loader.browser.js:75
- **Description**: Browser 端 YAML 解析同样直接写入普通对象，存在 __proto__/constructor 污染风险。
- **Suggestion**: 改为 Object.create(null) 并过滤敏感 key。
```
const result = {};
const key = match[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
result[key] = value;
```

---

## Archived: 2026-01-19

### [RESOLVED] 原型污染
*Archived: 2026-01-19T20:46:18.988Z*

- **File**: js/agents/skills/loader.node.js:73
- **Description**: YAML frontmatter 的 key 直接写入普通对象，恶意 skill 可通过 __proto__/constructor/prototype 污染原型链。
- **Suggestion**: 改为使用 Object.create(null) 存储 map，并显式拒绝 __proto__/prototype/constructor 等 key。
```
const result = {};
const key = match[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
result[key] = value;
```

---

## Archived: 2026-01-18

### [RESOLVED] JSDoc completeness
*Archived: 2026-01-18T21:26:43.451Z*

- **File**: js/agents/skills/user-store.js:137
- **Description**: user-store.js 多个导出函数缺少 @param/@returns（configureUserSkillStoreEncryption、initUserSkillStore、listUserSkills、loadUserSkillsIndex、saveUserSkillsIndex、getUserSkillBody、setUserSkillBody、upsertUserSkill、deleteUserSkill、clearUserSkills）。
- **Suggestion**: 为每个导出函数补齐 JSDoc（@param/@returns，必要时补 @typedef）以满足类型注解规范。
```
export function configureUserSkillStoreEncryption(options = {}) {
```

### [RESOLVED] JSDoc completeness
*Archived: 2026-01-18T21:26:43.451Z*

- **File**: js/agents/skills/loader.browser.js:347
- **Description**: Browser loader 的 loadSkillsFromNexus 与 loadSkillFromPath 缺少类型注解。
- **Suggestion**: 补充 @param/@returns，并说明 nexusProvider 形态与返回值结构。
```
export async function loadSkillsFromNexus(nexusProvider) {
```

### [RESOLVED] JSDoc completeness
*Archived: 2026-01-18T21:26:43.451Z*

- **File**: js/agents/skills/sandbox-adapter.js:98
- **Description**: sandbox-adapter 的 createSandboxedSkillsManager/analyzeSkillRisk 未声明参数与返回类型。
- **Suggestion**: 为函数添加完整 JSDoc，标明 options 结构与返回的 SkillsManager 扩展接口。
```
export async function createSandboxedSkillsManager(options = {}) {
```

### [RESOLVED] JSDoc completeness
*Archived: 2026-01-18T21:26:43.451Z*

- **File**: js/agents/skills/render.js:139
- **Description**: renderSkillsList 缺少 @param/@returns，无法明确输入/输出类型。
- **Suggestion**: 补充 JSDoc（@param {Object[]} skills, @returns {string}）。
```
export function renderSkillsList(skills) {
```

### [RESOLVED] Error handling
*Archived: 2026-01-18T21:26:43.451Z*

- **File**: js/agents/skills/sandbox-adapter.js:53
- **Description**: 错误分支直接访问 err.message，若远程 provider 抛出非 Error（如 null/字符串）会再次抛错，掩盖原始失败。
- **Suggestion**: 使用 `err instanceof Error ? err.message : String(err)` 以避免二次异常。
```
error: `Failed to load remote skill: ${err.message}`,
```

### [RESOLVED] Error handling
*Archived: 2026-01-18T21:26:43.451Z*

- **File**: js/agents/skills/loader.node.js:285
- **Description**: Node loader 在 catch 中假设 err 为 Error，err.message 可能触发 TypeError。
- **Suggestion**: 改为 `err instanceof Error ? err.message : String(err)`，并统一错误格式。
```
message: err.message,
```

### [RESOLVED] Async error handling
*Archived: 2026-01-18T21:26:43.451Z*

- **File**: js/agents/skills/loader.browser.js:300
- **Description**: 用户技能存储初始化失败被静默吞掉，可能导致加载结果缺失且难以排查。
- **Suggestion**: 至少记录日志或将错误写入 outcome.errors 以便诊断。
```
try {
  await initUserSkillStore();
  const userList = listUserSkills();
} catch {
  // ignore user skill store errors
}
```

### [RESOLVED] Dead code
*Archived: 2026-01-18T21:26:43.451Z*

- **File**: js/agents/skills/sandbox-adapter.js:8
- **Description**: SandboxPreset 与 ResourceLimits 被引入但未使用，增加维护噪声。
- **Suggestion**: 移除未使用的 import，或实际使用它们配置沙箱。
```
import { SandboxPreset, ResourceLimits } from '../core/sandbox/index.js';
```

---

