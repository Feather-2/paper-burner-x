# Analysis: Sandbox & Environment (沙箱与环境)

## 1. 架构 (Architecture)

### 多层次沙箱隔离 (`src/sandbox/`)
- **统一执行器 (`SandboxExecutor` & `executor.ts`)**: 自动探测当前系统最合适的沙箱技术（Linux: `bubblewrap`, macOS: `seatbelt`, 跨平台: `docker`）。
- **预设配置系统 (`SANDBOX_PRESETS`)**: 提供多种安全级别：
  - `strict`: 禁用网络，极低内存（512MB），仅限 /tmp 写入。
  - `development`: 允许网络，读写当前工作目录。
  - `testing`: 针对测试环境优化的隔离策略。
  - `aicode`: 极短的超时时间（10s）和进程数限制（5个），防止 AI 代码死循环。
- **资源限制 (`ResourceLimiter`)**: 
  - 通过 `cgroups V2` (Linux) 或 `ulimit` 限制 CPU、内存、文件大小和进程数。
  - 支持 `parseMemoryString` 转换友好的内存单位（如 "1GB"）。
- **虚拟文件系统控制**: 
  - `readOnlyPaths`: 固定系统目录（/usr, /bin, /etc 等）为只读。
  - `writablePaths`: 限制写入范围。
  - 路径冲突检测：自动警告允许路径与拒绝路径之间的包含关系。

### 环境自适应
- **平台感知 (`utils/platform.ts`)**: 系统能自动检测 Windows/Linux/macOS 并切换对应的 Shell、路径格式和沙箱策略。
- **IDE 集成 (`src/ide/`)**: 识别当前是否运行在 VSCode, Cursor 或 Zed 等 IDE 终端内，并据此调整提示风格和工具链。

## 2. 优化 Trick (Optimization Tricks)

- **网络只读挂载**: 对敏感的系统 DNS 和网络配置文件采用只读挂载，防止沙箱内的恶意脚本修改网络路由。
- **热启动沙箱**: 预先启动一个“冷”沙箱实例，当 Agent 调用工具时快速切换上下文，将启动延迟降至毫秒级。
- **信号劫持**: 在 `executor.ts` 中劫持沙箱产生的特定信号，将底层的 OOM (内存溢出) 或权限错误转化为 Agent 可理解的友好提示。

## 3. 对我们 Agent (docs\agents) 的可取之处

- **彻底的命令执行安全**: 目前我们的 Agent 直接在宿主机执行命令。引入 `sandbox` 模块，可以让 Agent 在本地 Docker 容器中运行测试和安装依赖，完全消除对宿主机的潜在威胁。
- **多平台一致性**: 通过 `platform.ts` 的抽象层，让我们的 Agent 提示词和工具能无缝兼容 Windows 和 Linux 开发环境。
- **资源配额控制**: 限制 Agent 启动的后台进程的最大内存。防止 Agent 编写了死循环代码后直接卡死用户的整个操作系统。
- **虚拟路径映射**: 无论代码在哪，都给 Agent 一个统一的虚拟根目录（如 `/home/agent/project`），这样可以简化 Agent 内部的路径处理逻辑。
