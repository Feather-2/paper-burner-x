# Audit History - debug

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] Sensitive data exposure
*Archived: 2026-01-18T21:14:44.351Z*

- **File**: js/agents/plugins/debug/logger.js:67
- **Description**: debug/logger 会把事件 payload 原样写入 console 并缓存在内存中，未做字段脱敏或过滤，可能将 token 等敏感数据暴露到日志或调试接口。
- **Suggestion**: 增加字段脱敏/白名单过滤，或默认关闭 includeEventData，并确保仅在开发环境启用。
```
pushBuffer({ level, event, data, timestamp: Date.now() });
```

### [RESOLVED] Debug interface exposure
*Archived: 2026-01-18T21:14:44.351Z*

- **File**: js/agents/plugins/debug/inspector.js:175
- **Description**: 开启 exposeGlobal 会将 inspector 挂到 globalThis，任何脚本都可读取内核状态并调用服务，生产环境存在信息泄露/越权风险。
- **Suggestion**: 仅在 development 环境允许 exposeGlobal，或增加显式权限/环境校验并在生产强制关闭。
```
globalThis.__kernelInspector = inspector;
```

### [RESOLVED] JSDoc compliance
*Archived: 2026-01-18T21:14:44.351Z*

- **File**: js/agents/plugins/debug/inspector.js:34
- **Description**: Inspector 公共 API JSDoc 大量使用 {any} 且缺少 @param/@returns 描述，不符合项目规范。
- **Suggestion**: 用 @typedef 定义明确类型并补齐参数/返回值描述，避免 any。
```
* @returns {any}
```

### [RESOLVED] JSDoc compliance
*Archived: 2026-01-18T21:14:44.351Z*

- **File**: js/agents/plugins/debug/logger.js:79
- **Description**: Logger 服务接口返回类型使用 Record<string, any>/any[] 等泛型，缺少具体类型说明。
- **Suggestion**: 定义日志配置与缓冲条目的 typedef，并在 JSDoc 中给出描述。
```
* @returns {Record<string, any>}
```

### [RESOLVED] Function size
*Archived: 2026-01-18T21:14:44.351Z*

- **File**: js/agents/plugins/debug/inspector.js:25
- **Description**: inspector.install(ctx) 超过 50 行且承担多个职责，违背单一职责和函数长度约定。
- **Suggestion**: 拆分构建 inspector、注册服务、全局挂载等步骤为独立函数。
```
install(ctx) {
```

### [RESOLVED] Function size
*Archived: 2026-01-18T21:14:44.351Z*

- **File**: js/agents/plugins/debug/logger.js:28
- **Description**: logger.install(ctx) 超过 50 行，包含缓冲/格式化/事件分类多段逻辑，维护成本较高。
- **Suggestion**: 将缓冲管理、格式化、事件路由拆分为小函数或模块。
```
install(ctx) {
```

---

