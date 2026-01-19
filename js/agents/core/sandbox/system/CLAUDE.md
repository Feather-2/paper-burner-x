# system - 系统级沙箱模块

## 模块描述

提供跨平台的系统级进程隔离，用于在 Node/Bun/Deno 环境中安全执行 Shell 命令。模块会自动检测可用后端，并按隔离强度选择最佳方案：Linux Bubblewrap、macOS Seatbelt、Docker，最终退化到 Permission-only。`SandboxBackend.NONE` 仅作为开发环境标记（执行器不会自动选择）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `constants.js` | 后端/策略枚举与默认配置 |
| `detect.js` | 检测后端可用性与跨运行时命令执行 |
| `executor.js` | 统一执行器与快捷执行接口 |
| `bubblewrap.js` | Linux Bubblewrap 隔离实现 |
| `seatbelt.js` | macOS sandbox-exec (SBPL) 实现 |
| `docker.js` | Docker 容器隔离实现与镜像保障 |
| `permission.js` | 无沙箱降级与权限审批机制 |
| `path-utils.js` | 路径规范化与 SBPL 安全校验 |
| `index.js` | 模块导出与默认聚合 |

## 关键概念

- **后端优先级**：Bubblewrap > Seatbelt > Docker > Permission-only（`NONE` 不参与自动选择）
- **检测结果结构**：`{ backend, platform, available, version, path, error }`
- **统一执行结果**：`{ code, stdout, stderr, killed, backend }`
- **配置基线**：`workDir`、`allowedReadPaths`、`allowedWritePaths`、`allowNetwork`、`timeoutMs`、`memoryLimit` (Docker)、`env` (Bubblewrap/Docker)
- **路径规范化**：`normalizeSandboxPath()` 约束相对路径必须位于 `workDir` 内，`isSafeForSBPL()` 拒绝控制字符注入
- **环境变量**：Bubblewrap 会 `--clearenv` 后注入 `PATH/HOME/LANG`，再用 `env` 覆盖/追加；Docker 使用 `-e` 传入环境变量
- **Permission-only**：通过 `permissionHandler` 交互审批，并支持 `allowPattern()` 缓存规则与 `clearPermissions()` 清理

## 常见任务

**1) 直接执行命令 (自动选后端)**

```javascript
import { execInSandbox } from 'js/agents/core/sandbox/system';

const result = await execInSandbox('ls', ['-la'], {
  workDir: '/path/to/project',
  allowNetwork: false,
});
```

**2) 获取后端与可用性信息**

```javascript
import { createSystemSandbox } from 'js/agents/core/sandbox/system';

const sandbox = createSystemSandbox();
const info = await sandbox.getInfo();
// info.activeBackend, info.availableBackends, info.allBackends
```

**3) Permission-only 模式交互授权**

```javascript
import {
  createPermissionExecutor,
  createInteractivePermissionHandler,
} from 'js/agents/core/sandbox/system';

const executor = createPermissionExecutor({
  permissionHandler: createInteractivePermissionHandler({
    prompt: async (msg) => readline.question(msg),
  }),
});

const result = await executor.shell('rm -rf temp/');
```

**4) 传入环境变量 (Bubblewrap/Docker)**

```javascript
import { createSystemSandbox } from 'js/agents/core/sandbox/system';

const sandbox = createSystemSandbox({ workDir: '/path/to/project' });
const result = await sandbox.execute('node', ['script.js'], {
  env: { NODE_OPTIONS: '--max-old-space-size=256' },
});
```
