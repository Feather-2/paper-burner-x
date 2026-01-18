# Audit History - skills

Archived issues from security audits.

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

