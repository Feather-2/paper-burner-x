# Audit History - exec

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] security
*Archived: 2026-01-18T21:22:32.144Z*

- **File**: js/agents/runtime/exec/command-executor.js:264
- **Description**: execShell 直接把 command 交给系统 shell 执行，若由不可信输入拼接将导致命令注入/RCE 风险。
- **Suggestion**: 仅在可信输入下使用 execShell；不可信输入改用 exec(command, args) 或进行严格白名单/转义。
```
const shellArgs = isWindows ? ['/c', command] : ['-c', command];
```

### [RESOLVED] compatibility
*Archived: 2026-01-18T21:22:32.144Z*

- **File**: js/agents/runtime/exec/command-executor.js:8
- **Description**: 模块依赖 Node-only API（child_process/process/Buffer），在浏览器环境下不可用，若被前端打包会直接失败。
- **Suggestion**: 确保该模块仅在 Node 运行时引用，或提供 browser stub/条件导入隔离。
```
import { spawn } from 'node:child_process';
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:22:32.144Z*

- **File**: js/agents/runtime/exec/command-executor.js:283
- **Description**: execSimple 通过 @ts-ignore 扩展 Error 属性，说明缺少明确的 JSDoc 类型定义，影响类型检查与可维护性。
- **Suggestion**: 定义 ExecError typedef/自定义 Error 子类并用 JSDoc 类型断言替代 @ts-ignore。
```
// @ts-ignore - 附加额外信息
```

---

