# Audit History - transports

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] jsdoc
*Archived: 2026-01-19T23:48:29.684Z*

- **File**: js/agents/plugins/transports/process-transport.js:37
- **Description**: 部分 public API 的 @param 缺少描述，不符合 JSDoc 规范要求。
- **Suggestion**: 为所有 public 方法的 @param/@returns 补充简要说明；BinarySkillProvider 同步修正。
```
* @param {ProcessTransportOptions} options
```

---

## Archived: 2026-01-19

### [RESOLVED] unsafe-deserialization
*Archived: 2026-01-19T23:48:24.224Z*

- **File**: js/agents/plugins/transports/process-transport.js:197
- **Description**: 对外部进程输出直接 JSON.parse 且未做 schema 校验，任意结构数据会进入事件分发，存在事件注入/逻辑滥用风险。
- **Suggestion**: 为 JSON-RPC 消息添加 schema/字段白名单校验（id/method/params），限制 method 字符集与长度，非法消息直接丢弃并记录。
```
const message = JSON.parse(trimmed); this._handleMessage(message);
```

---

## Archived: 2026-01-19

### [RESOLVED] error-handling
*Archived: 2026-01-19T23:48:11.299Z*

- **File**: js/agents/plugins/transports/process-transport.js:257
- **Description**: disconnect 中的空 catch 吞掉异常，违反错误处理约定，可能隐藏资源清理失败。
- **Suggestion**: 至少记录日志或 emit "transport:error"；必要时 rethrow。
```
try { this.process.stdin?.end(); this.process.kill("SIGTERM"); } catch { // ignore }
```

---

## Archived: 2026-01-19

### [RESOLVED] sandbox-escape
*Archived: 2026-01-19T23:48:06.810Z*

- **File**: js/agents/plugins/transports/process-transport.js:84
- **Description**: ProcessTransport 直接 spawn 外部命令且未限制 allowlist/隔离；若 config 来自不可信输入，可能导致任意命令执行或沙箱逃逸。
- **Suggestion**: 对 command/args/cwd 做白名单与路径校验，限制环境变量；在容器/低权限用户下执行，必要时引入 sandbox 适配层。
```
this.process = spawn(this.command, this.args, { cwd: this.cwd, env: this.env, stdio: ["pipe", "pipe", "pipe"], signal: this.signal });
```

---

