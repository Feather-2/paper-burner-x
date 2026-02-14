# system - 系统级沙箱模块

## 模块描述

提供跨平台的系统级进程隔离，用于在 Node/Bun/Deno 环境中安全执行外部命令（推荐 `command + args` 模式，避免 shell 字符串拼接）。模块自动检测可用后端，并按隔离强度选择最佳方案：Linux Bubblewrap、macOS Seatbelt、Docker，最终退化到 Permission-only。`SandboxBackend.NONE` 仅作为开发环境标记（执行器不会自动选择）。

> 注意：浏览器运行时不支持系统级进程隔离与子进程执行；请仅在支持 `spawn/exec` 的运行时使用本模块。

## 核心文件

| 文件 | 职责 |
|------|------|
| `constants.js` | 后端/策略枚举与默认配置 |
| `detect.js` | 检测后端可用性与跨运行时命令执行 |
| `executor.js` | 统一执行器与快捷执行接口 |
| `bubblewrap.js` | Linux Bubblewrap 隔离实现（mandatory deny、symlink 检测、seccomp、代理桥接） |
| `seatbelt.js` | macOS sandbox-exec (SBPL) 实现 |
| `docker.js` | Docker 容器隔离实现与镜像保障 |
| `permission.js` | 无沙箱降级与权限审批机制 |
| `path-utils.js` | 路径规范化与 SBPL 安全校验 |
| `index.js` | 模块导出与默认聚合 |

## 关键概念

- **后端优先级**：Bubblewrap > Seatbelt > Docker > Permission-only（`NONE` 不参与自动选择）
- **检测结果结构**：`{ backend, platform, available, version, path, error }`
- **统一执行结果**：`{ code, stdout, stderr, killed, backend }`
- **SandboxPolicy**：`no-network` / `read-only-fs` / `restrict-write` / `no-spawn`
- **默认配置**：`DefaultSandboxConfig`（`allowNetwork=false`、`timeoutMs=60000`、`memoryLimit=512MB`）
- **Bubblewrap 强化隔离**：
  - Mandatory deny paths：默认保护 `.bashrc`、`.gitconfig`、`.git/hooks` 等敏感路径
  - Symlink 检测：防止通过符号链接绕过写入限制
  - PID namespace + `/proc`：隔离进程可见性，降低信息泄露风险
- **高级选项**：
  - `denyPaths`：附加拒绝写入路径
  - `disableMandatoryDeny`：关闭内建 deny（默认 `false`，生产环境不建议）
  - `onViolation`：策略违规回调
  - `seccomp`：二阶段 BPF 过滤（`applySeccompPath` + `bpfPath`）
  - `networkProxy`：`--unshare-net` + Unix socket 代理桥接
- **路径规范化**：`normalizeSandboxPath()` 约束相对路径必须位于 `workDir` 内；`isSafeForSBPL()` 拒绝控制字符注入
- **Permission-only**：通过 `permissionHandler` 交互审批，支持 `allowPattern()` 缓存规则与 `clearPermissions()` 清理

## 常见任务

**1) 直接执行命令（自动选后端）**

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
```

**3) 启用 Bubblewrap 高级安全能力**

```javascript
import { execInSandbox } from 'js/agents/core/sandbox/system';

const result = await execInSandbox('python3', ['script.py'], {
  workDir: '/workspace',
  allowNetwork: false,
  denyPaths: ['.env', '.ssh'],
  seccomp: {
    enabled: true,
    bpfPath: '/opt/pb/seccomp/filter.bpf',
    applySeccompPath: '/opt/pb/seccomp/apply-seccomp',
    arch: 'x64',
  },
  networkProxy: {
    httpSocketPath: '/run/pb/http-proxy.sock',
  },
});
```

## 安全边界与最佳实践

- 始终使用 `command + args`，禁止拼接 shell 命令字符串
- `seccomp` 与 `networkProxy` 路径必须来自可信配置（建议固定 allowlist）
- 不要在运行期直接修改 `DefaultSandboxConfig`，改用调用参数覆盖
- 对 `allowedReadPaths`/`allowedWritePaths`/`denyPaths` 做最小权限配置
- 对违规回调 `onViolation` 仅输出脱敏信息，避免泄露宿主绝对路径

## 兼容性说明

- 该模块为系统级能力，依赖 `node:fs`、`node:path`、子进程与平台命令检测
- 仅适用于 Node/Bun/Deno 等支持系统调用的运行时，不应直接打包到浏览器端执行
- 若是浏览器场景，使用上层沙箱抽象并在运行时显式禁用 system backend
