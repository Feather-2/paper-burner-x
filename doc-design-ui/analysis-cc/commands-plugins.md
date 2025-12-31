# Analysis: Commands & Plugins (命令与插件)

## 1. 架构 (Architecture)

### 命令注册中心 (`src/commands/`)
- **命令注册表 (`commandRegistry`)**: 负责初始化及执行斜杠命令（如 `/config`, `/session`, `/api`）。
- **执行上下文**: 命令执行时可访问 `session`, `config`, `ui` 及原始输入参数。
- **模块化注册**: 支持按类别注册（`General`, `Session`, `Config`, `Auth`, `MFA`, `Tools`, `Utility`, `Development`, `Api`）。

### 插件体系 (`src/plugins/`)
- **插件管理器 (`PluginManager`)**: 核心控制中心，负责发现（Discovery）、加载（Load）、卸载（Unload）和依赖管理。
- **生命周期钩子**: 插件支持 `init`, `activate`, `deactivate` 三阶段生命周期。
- **沙箱上下文 (`PluginContext`)**: 为插件提供受限的文件系统访问、配置管理、日志记录及功能注册接口（Tools, Commands, Skills, Hooks）。
- **智能推荐系统 (`PluginRecommender`)**: 根据当前文件扩展名（如 `.jsx`, `.py`）或用户查询关键词，匹配预定义规则推荐安装对应插件。
- **热重载支持**: 监听插件目录下的文件变更（防抖处理），实现无感知自动更新。
- **内联插件**: 支持通过 `registerInlinePlugin` 无需文件系统直接动态注入轻量插件。

## 2. 优化 Trick (Optimization Tricks)

- **别名系统**: 支持为长命令设置简写别名（Alias），提升高级用户的操作速度。
- **交互式命令参数**: 命令处理器支持在参数缺失时自动调用 UI 组件进行补充提问，而不是直接报错。
- **插件延迟加载**: 核心逻辑启动时不加载非必要插件，只有在对应命令被触发时才按需实例化，保证了 CLI 的极致启动速度。

## 3. 对我们 Agent (docs\agents) 的可取之处

- **斜杠命令增强交互**: 我们的 Agent 目前多是对话式。引入类似的 `/help`, `/tokens`, `/reset` 命令，可以让用户更快捷地管理会话状态。
- **插件化工具扩展**: 建立一个 `plugins/` 目录，允许团队成员将自己写的特殊工具（如针对特定内部系统的 API）以插件形式放入，而不需要修改核心代码。
- **会话管理命令**: 模仿其 `session.ts` 相关的命令，实现对话的导出、合并和状态检查。
- **环境预检查**: 在执行复杂命令（如部署脚本）前，利用 `development.ts` 中的预检查逻辑，确保本地 Node/Docker 环境已就绪。
