# Analysis: Lifecycle & Config (生命周期与配置)

## 1. 架构 (Architecture)

### 模块化生命周期系统 (`src/lifecycle/`)
- **两级事件模型**: 将生命周期划分为 `CLI` 级别（进程启动、加载）和 `Action` 级别（具体任务执行的各阶段）。
  - CLI 事件：`cli_entry`, `cli_imports_loaded`, `cli_ripgrep_path`, `cli_after_main_complete` 等。
  - Action 事件：`action_handler_start`, `action_tools_loaded`, `action_commands_loaded`, `action_after_hooks` 等。
- **解耦的事件总线**: 通过 `LifecycleManager` 实现插件化的处理方式。提供 `emitLifecycleEvent` (x9) 辅助函数触发事件。

### 强类型分层配置系统 (`src/config/`)
- **基于 Zod 的严格校验**: 使用 `UserConfigSchema` 校验核心字段（API Key, Model, MaxTokens, Permissions）。
- **优先级链与来源追踪**: 详细记录每个配置项的 `ConfigSource`（如 `userSettings`, `envSettings`, `policySettings`）。
- **企业策略控制**: `EnterprisePolicyConfig` 允许通过 `managed_settings.json` 强制执行 (Enforced) 设置或禁用功能，且优先级最高。
- **备份与自动恢复**: `backupConfig` 逻辑在修改配置前自动备份，并保留最近 10 个副本。
- **.gitignore 集成**: 自动将 `settings.local.json`（机器特定配置）添加到项目的 `.gitignore` 中。

## 2. 优化 Trick (Optimization Tricks)

- **备份与自动恢复**: 每次保存配置前都会在 `.backups` 目录下创建带时间戳的副本，并自动保留最近 10 个，极大地提升了系统的容错性。
- **敏感信息掩码**: 在导出或记录配置时，使用 `maskSensitiveFields` 自动模糊处理 API Key 等隐私数据。
- **Git 自动隔离**: 当用户保存本地特定配置时，系统会自动检查并更新 `.gitignore`，确保这些机器相关的配置不会被意外提交。
- **配置迁移流水线**: 通过 `MIGRATIONS` 数组定义版本间的转换逻辑，确保旧版配置文件能平滑升级到新版本。

## 3. 对我们 Agent (docs\agents) 的可取之处

- **任务阶段钩子**: 我们的 Agent 目前是一个黑盒。可以引入类似的生命周期事件（如 `before_retrieval`, `after_thinking`），允许开发者挂载自定义的日志记录器或安全审查逻辑。
- **项目级配置优先**: 允许在每个项目目录下放置一个 `.agent/config.json` 来定制该项目的编码风格和工具白名单，而不是全局共用一套逻辑。
- **强类型配置约束**: 为我们的 Agent 增加 Zod 校验，确保传入的 Model ID 或温度等参数符合预期。
- **配置回滚能力**: 模仿其 `.backups` 逻辑，在 Agent 尝试自动修改配置文件（如修改项目规则）时，先备份原文件，以便任务失败时能自动还原。
