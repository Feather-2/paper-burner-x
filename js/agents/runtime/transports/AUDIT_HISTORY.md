# Audit History - transports

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] security/DoS
*Archived: 2026-01-18T21:23:15.597Z*

- **File**: js/agents/runtime/transports/process-transport.js:150
- **Description**: 接收缓冲区未设置上限，子进程若持续输出无换行内容会导致 this.buffer 无限增长，存在内存耗尽风险。
- **Suggestion**: 为 buffer 设置最大长度/行长度，超过阈值时丢弃、截断或主动断开连接，并记录告警。
```
  _processBuffer() {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";
```

### [RESOLVED] reliability/async
*Archived: 2026-01-18T21:23:15.597Z*

- **File**: js/agents/runtime/transports/process-transport.js:90
- **Description**: connect() 仅等待固定 50ms 后即标记 connected 并 resolve；若子进程快速退出或尚未就绪，调用方会拿到假阳性连接状态。
- **Suggestion**: 改为基于子进程 spawn/ready 信号、首条有效输出或握手响应来 resolve，并在 exit/error 时清理定时器与拒绝 connect。
```
        setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.connected = true;
            this.emit("connected");
            resolve();
          }
        }, 50);
```

### [RESOLVED] async-error-handling
*Archived: 2026-01-18T21:23:15.597Z*

- **File**: js/agents/runtime/transports/binary-skill-provider.js:88
- **Description**: autoReconnect 使用 setTimeout 直接调用 _initSkill，失败会产生未处理的 Promise rejection；同时 shutdown 会触发 exit 事件导致自动重连继续发生。
- **Suggestion**: 增加 provider 级关闭标记，在 shutdown 后阻止重连；对重连路径加 catch 并引入指数退避/最大重试。
```
    transport.on("exit", ({ code, signal }) => {
      this._emit(`binary.${config.name}.exit`, { code, signal });
      this._connections.delete(config.name);

      if (config.autoReconnect) {
        setTimeout(() => this._initSkill(config), 1000);
      }
    });
```

### [RESOLVED] convention
*Archived: 2026-01-18T21:23:15.597Z*

- **File**: js/agents/runtime/transports/binary-skill-provider.js:76
- **Description**: 事件名约定为 domain:action，但 BinarySkillProvider 使用 binary.<skill>.<event> 点分隔，ProcessTransport 也有 message/parse_error 等非 domain:action 事件名，可能导致订阅不一致。
- **Suggestion**: 统一事件命名为 domain:action（例如 binary:message、binary:<skill>:connected），或在 emit 时提供兼容映射。
```
    transport.on("message", (msg) => {
      this._emit(`binary.${config.name}.message`, msg);
      if (msg.method) {
        this._emit(`binary.${config.name}.${msg.method}`, msg.params);
      }
    });
```

---

