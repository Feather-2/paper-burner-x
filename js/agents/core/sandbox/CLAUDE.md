# sandbox - 沙箱隔离系统

提供沙箱隔离核心能力（WASM + System），并与 `node-compat`、`webruntime` 两个模块协同工作。

## 模块拆分

> 自 commit `03d6fab6` 起，原 `sandbox/` 拆分为三个职责清晰的模块：

| 模块 | 路径 | 职责 |
|------|------|------|
| **sandbox** | `./` | 隔离核心（WASM sandbox + system sandbox + capability/preset/limits + plugin） |
| **node-compat** | `../node-compat/` | Node.js 兼容层（require/module-resolver/shims/npm/ToolExecutor 集成） |
| **webruntime** | `../webruntime/` | 浏览器运行时（dev-server/HMR/SW/worker bridge/VFS snapshot/events） |

## 架构

```text
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

> `index.js` 作为统一入口（向后兼容）：浏览器环境可安全导入 WASM 相关导出与 system 常量；System Sandbox 的函数在浏览器会抛出明确错误，并在 Node-like 环境通过动态 import 延迟加载真实实现。

## 子模块

| 子模块 | 路径 | 职责 |
|--------|------|------|
| **WASM** | `./` | QuickJS WASM 沙箱 (Skill 执行) |
| **System** | `./system/` | 系统级沙箱 (系统隔离/命令执行) |

## 1. WASM Sandbox (浏览器)

基于 QuickJS WASM 的安全执行环境，用于运行不可信 Skill 代码。

### 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 统一入口（含向后兼容重导出） |
| `sandbox-interface.js` | `SandboxInterface` 抽象接口 |
| `create-sandbox.js` | `createSandbox` 工厂封装 |
| `wasm-sandbox.js` | `WasmSandbox` 主类 (QuickJS WASM 隔离执行) |
| `iframe-eval-bridge.js` | iframe eval 桥接（受控执行） |
| `iframe-sandbox.js` | iframe 沙箱执行器 |
| `skill-executor.js` | `SkillExecutor` 技能执行器 |
| `skill-executor-helpers.js` | Skill 执行辅助函数 |
| `pool.js` | `SandboxPool` 沙箱池 |
| `plugin.js` | `createSandboxPlugin`（Kernel 集成） |
| `constants.js` | 能力/预设/资源限制常量 |
| `violation-store.js` | `createViolationStore` — 违规记录存储 (网络策略/能力越权等) |
| `network-policy-utils.js` | 网络策略匹配与校验工具 |
| `system/` | 系统级沙箱子模块（后端探测/执行器/策略） |

### 跨模块能力（拆分后）

以下能力已迁出 `sandbox/`，请参考对应模块文档：

- ToolExecutor 集成、Node.js 兼容层、`module-resolver` 缓存、npm 包管理：`../node-compat/CLAUDE.md`
- 浏览器运行时（DevServer/HMR/SW handler/Worker bridge/VFS snapshot/events）：`../webruntime/CLAUDE.md`

### 公共导出（浏览器/Node 兼容）

- 沙箱核心导出（推荐直接使用）：
  - `WasmSandbox`, `createSandbox`
  - `SandboxPool`
  - `createSandboxPlugin`
  - `SkillExecutor`, `createSkillExecutor`, `isWasmSupported`
  - `SandboxCapability`, `SandboxPreset`, `ResourceLimits`
- `index.js` 仍保留向后兼容重导出（含 `node-compat` / `webruntime`）。
- 新代码建议直接从规范入口导入：
  - `../node-compat/index.js`
  - `../webruntime/index.js`

### 能力模型 (SandboxCapability)

能力用于描述“授予 Skill 的权限集合”。

注意：这些常量导出为普通对象/数组；请将其视为只读配置，不要在运行时修改。如需自定义，复制一份再调整。

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

- `MINIMAL`：仅 console
- `SKILL`：console + state + emit（默认推荐）
- `NETWORK`：在 `SKILL` 基础上增加 fetch
- `TRUSTED`：完整能力（仅用于可信 Skill）

```js
import { SandboxPreset } from './constants.js';

SandboxPreset.MINIMAL;
SandboxPreset.SKILL;
SandboxPreset.NETWORK;
SandboxPreset.TRUSTED;
```

> 注意：`TRUSTED` 包含 `FS_WRITE` 与 `EXEC`，必须配合可信来源、审计与额外的运行时隔离使用。

### 资源限制 (ResourceLimits)

用于限制单次执行的资源配额，避免死循环/深递归/过高内存占用导致宿主不稳定。

| 预设 | memoryLimit (bytes) | timeoutMs | maxStackDepth | 适用场景 |
|------|---------------------|----------|---------------|----------|
| LIGHT | 1 * 1024 * 1024 | 1000 | 100 | 轻量任务、快速评估 |
| STANDARD | 8 * 1024 * 1024 | 30000 | 500 | 默认执行档位 |
| HEAVY | 64 * 1024 * 1024 | 300000 | 1000 | 重型分析/批处理（谨慎使用） |

### Plugin 集成 (createSandboxPlugin)

`createSandboxPlugin` 将沙箱能力集成到 Kernel，为 Skills 系统提供 sandbox 服务，并使用 `SandboxPool` 管理沙箱复用。

`SandboxPluginOptions`：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| poolSize | number | 4 | 沙箱池大小 |
| idleTimeoutMs | number | 60000 | 空闲回收超时（毫秒） |
| defaultCapabilities | string[] | （建议 `SandboxPreset.SKILL`） | 默认能力集（推荐最小化） |
| defaultLimits | Object | （建议 `ResourceLimits.STANDARD`） | 默认资源限制 |

建议：`defaultCapabilities` 仅在确有需要时提升到 `NETWORK`，避免默认授予 `FS_WRITE/EXEC`。

## 2. System Sandbox (Node / Bun / Deno)

系统级隔离（namespace / sandbox-exec / 容器等），用于执行高风险的系统操作。

### System 常量（浏览器安全）

以下常量从 `./system/constants.js` 导出，不依赖 Node API，浏览器环境可安全导入：

- `SandboxBackend`
- `SandboxPolicy`
- `DefaultSandboxConfig`
- `Platform`

### Node-only API（浏览器会抛错）

`index.js` 对 System Sandbox 的函数导出采用 Node-like 环境动态 import 延迟加载；在浏览器环境调用会抛出明确错误。

已知示例：

- `detectAllBackends()`
- `detectBestBackend()`
- `getPlatform()`

其余 System API 见 `./system/index.js`。

### 网络策略 (Network Policy)

`ClientRequest`（http/https shim）支持域名级网络过滤，灵感来自 Anthropic Sandbox Runtime 的 `filterNetworkRequest`。

```js
import { createBuiltinModules } from '../node-compat/shims/index.js';

const modules = createBuiltinModules({
  vfs,
  networkPolicy: {
    allowedDomains: ['registry.npmjs.org', '*.github.com'],
    deniedDomains: ['evil.com'],           // 优先于 allowedDomains
    // onViolation: (info) => { ... }      // 可选：自定义违规回调
  },
  violationStore,                           // 可选：自动记录被拒操作
});
```

- `allowedDomains` — 白名单模式，空数组 `[]` = 阻止所有请求
- `deniedDomains` — 黑名单，优先于白名单
- 支持 `*.example.com` 通配符（匹配子域名，不匹配基域名本身）
- 被阻止的请求抛出 `ERR_NETWORK_POLICY` 错误

### VFS 写保护 (Protected Paths)

`createFsShim` 支持 `protectedPaths` 选项，强制指定路径为只读（灵感来自 ASRT 的 Mandatory Deny Paths）。

```js
import { createFsShim } from '../node-compat/shims/fs.js';

const fs = createFsShim(vfs, {
  protectedPaths: ['node_modules', '.env', '.git'],
  onViolation: (info) => violationStore.add(info),  // 可选
});

fs.writeFileSync('.env', 'hacked');  // → EPERM
fs.readFileSync('.env', 'utf8');     // → 正常读取
```

写保护覆盖所有写操作（writeFile, appendFile, unlink, rmdir, mkdir, rename, copyFile）的 callback / sync / promises 三种形式。读操作不受影响。

### 违规存储 (ViolationStore)

环形缓冲区记录被拒绝的沙箱操作，用于审计和调试。

```js
import { createViolationStore } from './violation-store.js';

const store = createViolationStore({ maxEntries: 256 });
store.subscribe((v) => console.warn('Violation:', v.type, v.detail));

// 通过 createBuiltinModules 自动集成
const modules = createBuiltinModules({ vfs, violationStore: store, networkPolicy: { ... } });
```

类型：`network` | `fs:read` | `fs:write` | `exec` | `capability`

### 事件与边界

- 事件名遵循 `domain:action`（如 `agent:step`），对 `EMIT` 能力应做事件白名单或命名空间隔离。
- 对 `FETCH` 能力必须有域名白名单、私网网段阻断、超时与响应大小限制，避免 SSRF 与资源耗尽。
- 沙箱配置对象视为只读；若需要定制，请拷贝并仅允许有限字段的覆盖。
