# Audit History - cli

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] prototype-pollution
*Archived: 2026-01-20T04:20:06.429Z*

- **File**: js/agents/cli/demo.js:70
- **Description**: redactSensitive 把任意键复制到普通对象上，未过滤 __proto__/constructor/prototype，存在原型污染风险。
- **Suggestion**: 改用 Object.create(null) 并过滤 __proto__/constructor/prototype 键，或使用安全的拷贝工具。
```
const out = {}; ... out[k] = redactSensitive(v, [...keyPath, k]);
```

---

## Archived: 2026-01-20

### [RESOLVED] error-handling/empty-catch
*Archived: 2026-01-20T00:10:18.441Z*

- **File**: js/agents/cli/test-deepsearch.js:83
- **Description**: findMdFiles 吞掉目录读取异常，违反错误处理规范，可能导致文档被静默跳过。
- **Suggestion**: 记录失败目录和错误信息，或在非权限错误时重新抛出，避免静默遗漏。
```
} catch { /* intentional: skip unreadable directories */ }
```

---

## Archived: 2026-01-18

### [RESOLVED] compatibility
*Archived: 2026-01-18T21:07:08.361Z*

- **File**: js/agents/cli/model-client.js:13
- **Description**: CLI 模块直接使用 Node-only API（node:fs/node:path/node:url/process.env），与“浏览器兼容性（无 Node-only API）”约定冲突；若被打包到浏览器环境会直接失败。
- **Suggestion**: 将 CLI 代码明确标注为 Node-only（文档/构建排除），或抽离到 Node 入口并提供浏览器替代实现/适配层。
```
import { readFileSync, existsSync } from "node:fs";
```

### [RESOLVED] convention
*Archived: 2026-01-18T21:07:08.361Z*

- **File**: js/agents/cli/demo.js:103
- **Description**: 事件名采用点分隔（例如 demo.llm.start），未遵守约定的 domain:action 格式，导致事件命名规范不一致。
- **Suggestion**: 改为 demo:llm.start / demo:echo 等 domain:action 格式，并同步更新 .onEvent 订阅模式。
```
ctx.emit("demo.llm.start", { prompt, model: client.model });
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:07:08.361Z*

- **File**: js/agents/cli/demo.js:47
- **Description**: 多处函数缺少 @param/@returns 类型注解（如 createModelRouter/buildDemoAgent 等），与项目 JSDoc 约定不符，降低可读性与工具链类型检查效果。
- **Suggestion**: 为 CLI 脚本中的主要函数补全 JSDoc（@param/@returns/@typedef），尤其是对外暴露或复杂逻辑函数。
```
function createModelRouter() {
```

### [RESOLVED] async-error-handling
*Archived: 2026-01-18T21:07:08.361Z*

- **File**: js/agents/cli/test-deepsearch.js:292
- **Description**: 异步入口 main() 直接调用未加 .catch；若 askQuestion/文件 IO 等环节抛错，会形成未处理 Promise 拒绝（test-memory.js 同样存在）。
- **Suggestion**: 使用 main().catch(err => { console.error(...); process.exitCode = 1; })，并在 js/agents/cli/test-memory.js:90 同步处理。
```
main();
```

---

