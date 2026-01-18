# Audit History - deps

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] 安全-完整性校验
*Archived: 2026-01-18T21:13:16.739Z*

- **File**: js/agents/runtime/deps/dependency-manager.js:200
- **Description**: wheel 的 SHA256 校验失败会被 catch 吞掉并继续返回原始 URL，导致 micropip 仍会安装该 wheel，完整性校验被绕过。
- **Suggestion**: 校验失败时直接抛错或返回失败状态，阻止继续安装；必要时将错误上抛给调用方或记录安全告警。
```
if (wheel.sha256) {
  const hash = await sha256(data);
  if (hash !== wheel.sha256.toLowerCase()) {
    throw new Error(`SHA256 mismatch: expected ${wheel.sha256}, got ${hash}`);
  }
}
...
} catch (err) {
  logger.error(`Failed to cache wheel ${wheel.url}:`, { error: err.message });
  return wheel; // 失败时返回原始，让 micropip 直接从 URL 加载
}
```

### [RESOLVED] 安全-输入校验
*Archived: 2026-01-18T21:13:16.739Z*

- **File**: js/agents/runtime/deps/dependency-manager.js:193
- **Description**: wheel.url 直接用于 fetch，未限制协议或域名，可能引入 SSRF/供应链风险，且未强制 https 或 sha256。
- **Suggestion**: 限制为 https 且可选域名白名单；对外部 wheel 强制提供并校验 sha256。
```
const resp = await fetch(wheel.url);
if (!resp.ok) {
  throw new Error(`Failed to fetch ${wheel.url}: ${resp.status}`);
}
```

### [RESOLVED] 质量-JSDoc
*Archived: 2026-01-18T21:13:16.739Z*

- **File**: js/agents/runtime/deps/dependency-manager.js:44
- **Description**: 导出的 parsePackageName 与 sha256 缺少 @param/@returns 类型注解，影响 JSDoc 完整性与类型提示。
- **Suggestion**: 为导出函数补齐 @param 与 @returns，明确入参与返回类型。
```
/**
 * 解析包名（去掉版本约束）
 */
function parsePackageName(spec) {
...
/**
 * 计算 SHA-256 哈希
 */
async function sha256(data) {
```

### [RESOLVED] 质量-JSDoc
*Archived: 2026-01-18T21:13:16.739Z*

- **File**: js/agents/runtime/deps/python-skill-executor.js:178
- **Description**: 导出的 executePythonSkill 缺少 JSDoc 类型注解，无法满足导出 API 的类型规范。
- **Suggestion**: 补充 @param/@returns，并指明 SkillExecutionContext 与返回结果类型。
```
/**
 * 便捷方法：执行单个 Python Skill
 */
export async function executePythonSkill(skill, context, options = {}) {
```

### [RESOLVED] 质量-错误处理
*Archived: 2026-01-18T21:13:16.739Z*

- **File**: js/agents/runtime/deps/dependency-manager.js:163
- **Description**: _getCachedWheel 的异常被直接吞掉，可能隐藏 VFS 读取错误，导致重复下载或无法定位缓存问题。
- **Suggestion**: 至少在 debug/warn 级别记录异常原因，或将错误上抛给调用方以便处理。
```
try {
  const cached = await this.vfs.readFile(cachePath);
  if (!cached) return null;
  ...
  return { ...wheel, localPath: cachePath, cached: true };
} catch {
  return null;
}
```

---

