# npm Node-Compat 模块 (js/agents/core/node-compat/npm)

## 模块定位
在浏览器优先（Browser-first）场景下提供 npm 包安装能力，用于 Agent 运行时动态获取依赖。模块通过 `fetch + VFS` 避免直接依赖 Node `fs`，同时保持 Node.js 兼容。

## 目录结构
- `index.js`：安装编排入口（依赖解析、分层并发安装、重试、兼容性检查、事件派发）
- `registry.js`：npm Registry 客户端（包名编码、URL 规范化、元数据缓存）
- `resolver.js`：semver 解析与依赖版本选择
- `tarball.js`：tarball 下载/管理与写入 VFS
- `../package-compatibility.js`：包兼容性评分与告警

## 关键配置类型
### InstallOptions
| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `version` | `string` | `latest` | 目标 semver 范围 |
| `includeDeps` | `boolean` | `true` | 是否安装依赖 |
| `compatibilityThreshold` | `number` | `0.3` | 兼容性告警阈值（建议区间 0~1） |

### PackageManagerOptions
| 字段 | 类型 | 说明 |
|---|---|---|
| `registry` | `Registry` | Registry 客户端实例 |
| `resolver` | `DependencyResolver` | 依赖解析器实例 |
| `tarball` | `TarballManager` | tarball 管理器实例 |
| `vfs` | `VfsLike` | 文件系统抽象（Memory/OPFS/Storage） |
| `corsProxy` | `string` | 浏览器跨域代理前缀 |
| `concurrency` | `number` | 每层依赖并发数，默认 `4` |
| `compatibilityChecker` | `CompatibilityChecker` | 自定义兼容性检查函数 |
| `compatibilityThreshold` | `number` | 默认兼容性阈值，默认 `0.3` |

## 事件契约（domain:action）
- `install:start`：安装开始
- `install:compatibility`：兼容性评估结果
- `install:progress`：安装进度（含层内索引/总数）
- `install:complete`：安装完成
- `install:error`：安装失败

## 运行与兼容性约束
- 使用 ES Modules（`import/export`），禁止 `require`
- Browser-first：依赖 `fetch` 与 VFS，不直接使用 Node-only API
- 并发与重试由常量控制（如并发默认值、重试次数）
- 依赖注入优先：Registry/Resolver/Tarball/VFS 可替换，便于测试与隔离

## 安全边界
- `registryUrl` 必须做协议与主机校验（仅允许 `https` + 白名单）
- tarball 下载应进行完整性校验（如 `dist.shasum`）
- 解包路径必须防止路径穿越（禁止写出目标根目录）
- 错误事件对用户侧输出应脱敏，避免泄露内部堆栈

## 稳定性关注点
- 避免全局单例状态污染，安装上下文需任务级隔离
- 依赖图解析需检测循环依赖，防止无限安装循环
- 安装结束后释放监听器/临时状态，避免内存泄漏

## 测试建议
- 状态机转换：开始 → 兼容性 → 进度 → 完成/失败
- 并发安全：重复依赖去重、快速连续调用、重试行为
- 插件生命周期：中断/失败后的回滚与清理
- 边界输入：空包名、非法 semver、超长字符串、恶意 registry URL
- 资源边界：大依赖树、深层依赖、网络抖动/超时
