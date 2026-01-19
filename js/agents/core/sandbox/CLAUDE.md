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
| `wasm-sandbox.js` | WasmSandbox 主类 |
| `pool.js` | SandboxPool 沙箱池 |
| `plugin.js` | createSandboxPlugin |
| `skill-executor.js` | SkillExecutor 技能执行器 |
| `constants.js` | 能力/预设/资源限制常量 |

### 使用示例

```javascript
import { createSandbox, SkillExecutor } from 'js/agents/core/sandbox';

const sandbox = await createSandbox({
  preset: 'STANDARD',
  limits: { maxMemoryMB: 32 },
});

const executor = new SkillExecutor(sandbox);
const result = await executor.execute(skillCode, { input: data });
```

### 降级策略

- WASM 不可用时，降级到受限 JS 执行
- 可通过 `fallbackMode: "none"` 强制要求 WASM
- 可通过 `isWasmSupported()` 探测能力

## 2. System Sandbox (Node/Bun/Deno)

系统级进程隔离，用于安全执行 Shell 命令。

### 核心文件

| 文件 | 职责 |
|------|------|
| `system/constants.js` | 后端类型、策略、默认配置 |
| `system/detect.js` | 检测可用后端 |
| `system/executor.js` | 统一执行器 |
| `system/bubblewrap.js` | Linux Bubblewrap 实现 |
| `system/seatbelt.js` | macOS Seatbelt 实现 |
| `system/docker.js` | Docker 容器实现 |
| `system/permission.js` | Permission-only fallback |
| `system/path-utils.js` | 路径规范化与 SBPL 安全校验 |

### 后端优先级

| 优先级 | 后端 | 平台 | 隔离强度 |
|--------|------|------|----------|
| 1 | Bubblewrap | Linux | 强 (namespace) |
| 2 | Seatbelt | macOS | 强 (sandbox-exec) |
| 3 | Docker | 全平台 | 强 (container) |
| 4 | Permission-only | 全平台 | 弱 (用户审批) |

### 使用示例

```javascript
import { createSystemSandbox, execInSandbox } from 'js/agents/core/sandbox';

// 方式 1: 快捷函数
const result = await execInSandbox('ls', ['-la'], {
  workDir: '/path/to/project',
  allowNetwork: false,
});

// 方式 2: 执行器实例
const sandbox = createSystemSandbox({
  workDir: '/path/to/project',
  allowNetwork: false,
  onBackendSelected: (backend) => console.log(`Using: ${backend}`),
});

const result = await sandbox.shell('npm install');
console.log(result.stdout);
```

### 检测可用后端

```javascript
import { detectAllBackends, detectBestBackend } from 'js/agents/core/sandbox';

// 检测所有后端
const all = await detectAllBackends();
// [{ backend: 'bubblewrap', available: true, version: '...' }, ...]

// 检测最佳后端
const best = await detectBestBackend();
// { backend: 'bubblewrap', available: true, ... }
```

### Permission-only 模式

当没有系统级沙箱可用时，使用权限审批作为安全屏障：

```javascript
import {
  createPermissionExecutor,
  createInteractivePermissionHandler,
} from 'js/agents/core/sandbox';

const executor = createPermissionExecutor({
  permissionHandler: createInteractivePermissionHandler({
    prompt: async (msg) => readline.question(msg),
  }),
});

// 执行前会询问用户确认
const result = await executor.shell('rm -rf temp/');
```

## 常量

### SandboxBackend

```javascript
const SandboxBackend = {
  BUBBLEWRAP: 'bubblewrap',    // Linux namespace
  SEATBELT: 'seatbelt',        // macOS sandbox-exec
  DOCKER: 'docker',            // Docker 容器
  PERMISSION_ONLY: 'permission-only',  // 仅权限审批
  NONE: 'none',                // 无保护
};
```

### DefaultSandboxConfig

```javascript
const DefaultSandboxConfig = {
  allowedWritePaths: ['.', './output', './temp'],
  allowedReadPaths: ['.', '/usr', '/lib', '/lib64', '/bin', '/etc'],
  allowNetwork: false,
  timeoutMs: 60000,
  memoryLimit: 512 * 1024 * 1024,
};
```

## Windows 支持

Windows 没有原生系统级沙箱，选项：
1. **Docker Desktop** - 推荐，提供容器隔离
2. **WSL2** - 在 Linux 子系统中运行 Bubblewrap
3. **Permission-only** - Fallback，仅用户审批
