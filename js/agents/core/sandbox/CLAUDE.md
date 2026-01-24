# sandbox - 沙箱隔离系统

提供两层沙箱机制，覆盖浏览器和 Node/Bun/Deno 环境。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Sandbox Module                            │
├─────────────────────┬───────────────────────────────────────┤
│   WASM Sandbox      │         System Sandbox                │
│   (浏览器/跨平台)    │         (Node/Bun/Deno)               │
├─────────────────────┼───────────────────────────────────────┤
│ QuickJS WASM        │ ┌─────────────────────────────────┐  │
│ - 指令级隔离         │ │ Linux: Bubblewrap (namespace)  │  │
│ - 资源配额           │ │ macOS: Seatbelt (sandbox-exec) │  │
│ - 能力注入           │ │ 跨平台: Docker                  │  │
│                     │ │ Fallback: Permission-only       │  │
│                     │ └─────────────────────────────────┘  │
└─────────────────────┴───────────────────────────────────────┘
```

> `index.js` 作为统一入口：浏览器环境可安全导入 WASM 相关导出与 system 常量；System Sandbox 的函数在浏览器会抛出明确错误。

## 子模块

| 子模块 | 路径 | 职责 |
|--------|------|------|
| **WASM** | `./` | QuickJS WASM 沙箱 (Skill 执行) |
| **System** | `./system/` | 系统级沙箱 (Shell 执行) |

## 1. WASM Sandbox (浏览器)

基于 QuickJS WASM 的安全执行环境，用于运行不可信 Skill 代码。

### 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 统一入口（浏览器/Node 兼容） |
| `wasm-sandbox.js` | WasmSandbox 主类 |
| `pool.js` | SandboxPool 沙箱池 |
| `plugin.js` | createSandboxPlugin |
| `skill-executor.js` | SkillExecutor 技能执行器 |
| `constants.js` | 能力/预设/资源限制常量 |

### 能力模型 (SandboxCapability)

能力用于描述“授予 Skill 的权限集合”。

注意：这些常量导出为普通对象/数组；请将其视为只读配置，不要在运行时修改。

| 能力 | 值 | 风险 | 说明 |
|------|----|------|------|
| CONSOLE | `console` | low | 允许 `console.log/warn/error` |
| STATE | `state` | low | 只读 state 访问 |
| EMIT | `emit` | medium | 允许发射事件（需避免越权事件） |
| FETCH | `fetch` | medium | 受限 HTTP 请求（需配合域名白名单/SSRF 防护） |
| FS_READ | `fs:read` | medium | 只读文件访问（通常仅 Node-like 环境才可能生效） |
| FS_WRITE | `fs:write` | high | 文件写入（高危，仅可信 Skill） |
| EXEC | `exec` | critical | 子进程执行（极高危，仅可信 Skill） |

### 预设能力 (SandboxPreset)

- `MINIMAL`: 仅 `CONSOLE`
- `SKILL`: `CONSOLE` + `STATE` + `EMIT`
- `NETWORK`: `SKILL` + `FETCH`
- `TRUSTED`: `SandboxCapability` 全量（包含 `FS_WRITE`/`EXEC` 等高危能力）

### 资源限制 (ResourceLimits)

资源限制用于控制单次执行的配额：内存上限、执行时间、最大栈深度。

| 预设 | memoryLimit | timeoutMs | maxStackDepth | 适用 |
|------|-------------|-----------|---------------|------|
| LIGHT | 1MB | 1s | 100 | 轻量表达式/小任务 |
| STANDARD | 8MB | 30s | 500 | 默认（推荐） |
| HEAVY | 64MB | 5min | 1000 | 重计算（谨慎） |

### 使用示例

```javascript
import {
  createSandbox,
  SandboxPreset,
  ResourceLimits,
} from 'js/agents/core/sandbox';

const sandbox = await createSandbox({
  capabilities: SandboxPreset.SKILL,
  limits: ResourceLimits.STANDARD,
  state: { user: { id: 'u1' } },
});

const result = await sandbox.execute('state.user.id');
console.log(result.data);
```

```javascript
import { SkillExecutor } from 'js/agents/core/sandbox';

const executor = new SkillExecutor({ fallbackMode: 'none' });

const skill = {
  metadata: { name: 'demo', scope: 'user' },
  body: 'return args.x + 1;',
};

const result = await executor.execute(skill, { args: { x: 1 } });
console.log(result.data);
```

## 2. System Sandbox (Node / Bun / Deno)

系统级隔离后端（namespace / sandbox-exec / Docker 等），仅在 Node-like 环境可用。

- 浏览器环境下：System Sandbox 的函数导出会抛出明确错误（请使用 WASM Sandbox：`createSandbox`/`SkillExecutor`）。
- Node-like 环境下：System Sandbox 的真实实现通过动态 `import('./system/index.js')` 加载。

### 浏览器安全导出

以下常量不依赖 Node API，可在浏览器安全导入（来自 `./system/constants.js`）：

- `SandboxBackend`
- `SandboxPolicy`
- `DefaultSandboxConfig`
- `Platform`
