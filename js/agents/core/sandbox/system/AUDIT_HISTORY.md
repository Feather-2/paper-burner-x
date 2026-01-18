# Audit History - system

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] browser-compat
*Archived: 2026-01-18T19:08:27.323Z*

- **File**: js/agents/core/sandbox/system/bubblewrap.js:46
- **Description**: 在 Bubblewrap/Docker/Seatbelt/Permission-only 中直接使用 process.cwd()，在浏览器或 Deno 环境下调用将抛错，违背 browser-first 约定。
- **Suggestion**: 要求显式传入 workDir，或根据运行时使用 Deno.cwd() 并在浏览器返回错误/空值。
```
workDir = process.cwd(),
```

---

## Archived: 2026-01-18

### [RESOLVED] timeout-not-enforced
*Archived: 2026-01-18T19:08:22.950Z*

- **File**: js/agents/core/sandbox/system/detect.js:206
- **Description**: execCommand 传入 timeout 但 spawn 不会自动终止进程，长时间运行的子进程可能挂起并占用资源。
- **Suggestion**: 显式设置计时器超时后 kill 子进程，或使用 execFile+timeout；为 Deno/Bun 分支也补充超时终止逻辑。
```
const proc = spawn(cmd, args, { timeout, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
```

---

## Archived: 2026-01-18

### [RESOLVED] silent-catch
*Archived: 2026-01-18T19:07:52.456Z*

- **File**: js/agents/core/sandbox/system/detect.js:102
- **Description**: 后端探测中的异常被静默吞掉，丢失诊断信息并违反错误处理规范。
- **Suggestion**: 至少记录错误或填充 DetectionResult.error；需要保留上下文时使用 `new Error(..., { cause })`。
```
} catch { // ignore }
```

---

## Archived: 2026-01-18

### [RESOLVED] sbpl-injection
*Archived: 2026-01-18T19:07:20.863Z*

- **File**: js/agents/core/sandbox/system/seatbelt.js:127
- **Description**: SBPL profile 直接插入路径字符串，escapeForSBPL 仅处理引号与反斜杠；若路径含控制字符（如换行）可注入额外规则，扩大权限。
- **Suggestion**: 对路径做严格校验（拒绝 \n/\r/\0 与控制字符），或使用白名单字符集；必要时直接拒绝包含危险字符的路径。
```
lines.push(`(allow file-write* (subpath "${escapeForSBPL(absPath)}"))`);
```

---

## Archived: 2026-01-18

### [RESOLVED] permission-bypass-default
*Archived: 2026-01-18T19:06:50.674Z*

- **File**: js/agents/core/sandbox/system/permission.js:37
- **Description**: Permission-only 回退时若未提供 handler 会默认放行命令，导致无审批执行；结合 skipPermission 可被内部调用直接绕过。
- **Suggestion**: 默认改为 deny/抛错，要求显式提供 permissionHandler；仅在开发环境显式开关允许自动放行，并限制 skipPermission 的可达性。
```
const defaultPermissionHandler = async () => 'allow-once';
```

### [RESOLVED] permission-cache-too-broad
*Archived: 2026-01-18T19:06:50.674Z*

- **File**: js/agents/core/sandbox/system/permission.js:50
- **Description**: 权限缓存键未包含 args/path，允许用户对同一命令不同参数无限放行，存在权限扩大风险。
- **Suggestion**: 将 args/path 纳入缓存键或基于完整请求生成哈希；仅对完全相同的命令+参数允许 allow-always。
```
return `${request.type}:${request.command}:${request.workDir}`;
```

---

## Archived: 2026-01-18

### [RESOLVED] path-traversal
*Archived: 2026-01-18T19:06:22.296Z*

- **File**: js/agents/core/sandbox/system/bubblewrap.js:130
- **Description**: allowedWritePaths/allowedReadPaths 通过字符串拼接生成绝对路径，未做规范化或边界校验，`../` 可逃逸 workDir 并挂载任意主机路径，削弱沙箱隔离（同类逻辑也出现在 seatbelt.js 与 docker.js）。
- **Suggestion**: 使用 path.resolve 规范化并验证前缀（如 resolved.startsWith(workDir + path.sep)），拒绝 `..` 或未在显式白名单中的绝对路径；在 seatbelt.js 与 docker.js 同步处理。
```
const absPath = p.startsWith('/') ? p : `${workDir}/${p}`;
```

---

