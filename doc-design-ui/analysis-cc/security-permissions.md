# Analysis: Security & Permissions (安全与权限)

## 1. 架构 (Architecture)

### 声明式权限系统 (`src/permissions/`)
- **权限管理器 (`PermissionManager`)**: 核心决策中心，支持多种 `PermissionMode`：
  - `default`: 常规询问。
  - `bypassPermissions`: 绕过所有检查（企业策略可禁用）。
  - `dontAsk`: 自动允许安全操作，拒绝危险操作。
  - `acceptEdits`: 自动允许文件读写。
  - `plan`: 仅规划，不执行。
- **多维度规则匹配**:
  - **工具级**: 允许/禁止特定工具名（如禁止 `Bash`）。
  - **路径级**: 使用 `minimatch` 进行 Glob 匹配（如禁止访问 `.env` 或 `/etc/*`）。
  - **命令级**: 针对 Bash 命令行的正则表达式或前缀匹配。
  - **网络级**: 域名或 URL 模式匹配。
- **决策持久化**: 支持 `once`, `session`, `always` 三种决策范围。`always` 决策持久化到 `permissions.json`。
- **装饰器支持**: 提供 `@requiresPermission` 装饰器，在工具执行前自动触发检查。

### 运行时监控与安全 (`src/security/`)
- **注入防御**: `CommandInjectionDetector` 使用 `DANGEROUS_PATTERNS` 识别并阻止 Shell 注入。
- **敏感数据掩码**: `SensitiveFilter` 自动过滤工具输出中的 API Keys、令牌和私人信息。
- **路径遍历防御**: 强制执行 `path.resolve` 校验，确保所有操作锁定在允许的 `additionalWorkingDirectories` 内。
- **审计系统**: 结构化记录 `AuditLogEntry`，包含时间戳、工具、资源、决策结果和用户范围。

## 2. 优化 Trick (Optimization Tricks)

- **路径遍历防御**: 在文件操作前强制进行 `path.resolve` 和 `detectPathTraversal` 检查，防止利用 `../` 逃逸工作目录。
- **工作时间限制**: 策略引擎内置支持 `timeRange` 和 `daysOfWeek`，允许企业设置“仅限工作时间使用”的管控策略。
- **智能命令净化**: 拦截器不仅能阻止命令，还能通过 `sanitizedCommand` 对输入进行清理，剔除潜在的危险元字符。
- **域名后缀匹配**: 网络拦截器支持 `.domain.com` 样式的后缀匹配，方便一次性允许或禁用整个子域名集合。

## 3. 对我们 Agent (docs\agents) 的可取之处

- **沙箱逃逸防御**: 引入 `RuntimeMonitor` 的工作目录限制逻辑，确保我们的 Agent 无论如何被诱导，都无法操作用户电脑上的敏感系统文件。
- **工具权限细粒度化**: 目前我们的工具权限可能是全开或全关。模仿此引擎，可以实现“只允许 ReadTool 读取指定目录”或“禁用所有具有网络访问能力的工具”。
- **行为审计日志**: 为 Agent 增加一个不可篡改的 `security-audit.log`，记录它所有的工具调用和返回结果，作为事后复盘和安全合规的依据。
- **声明式安全规则**: 允许用户在项目根目录通过 `.agent/security.json` 定义自定义安全边界，如“禁止修改 `.env` 文件”或“禁止访问 `internal-api.com`”。
