# js/agents vs agentsdk-go 完整能力对比

> 日期：2026-02-15

---

## 一、身份定位

| 维度 | js/agents | agentsdk-go |
|------|-----------|-------------|
| **定位** | 浏览器优先的 AI 应用平台 | Go Agent SDK |
| **规模** | 544 文件，约 105K 行 | 约 60 文件，约 15K 行 |
| **语言** | JavaScript + JSDoc | Go |
| **运行环境** | Browser / Node.js / Deno / Bun | 编译为二进制 |
| **设计哲学** | 微内核 + 四总线 + 插件 + Stages | 接口组合 + 函数式选项 |
| **目标用户** | 前端/全栈开发者，AI4Sci 研究者 | 后端 Go 开发者 |

---

## 二、Agent 循环

| 维度 | js/agents | agentsdk-go |
|------|-----------|-------------|
| **入口** | `DefaultAgentLoop` + `MiddlewareChain` | `Agent.Run()` 简单 for 循环 |
| **核心规模** | 6 阶段洋葱模型（Koa 风格） | 约 70 行，编译期类型安全 |
| **基类问题** | `BaseAgentLoop` 第 392-397 行有 6 个 Mixin attach 函数 | 无此问题 |
| **循环逻辑** | 等价的核心循环，外加中间件包裹 | 直接的 for 循环 |
| **结论** | 功能更丰富，但结构透明度较低 | **Go 在结构透明性上胜出** |

---

## 三、中间件/拦截

| 维度 | js/agents | agentsdk-go |
|------|-----------|-------------|
| **体系数量** | **两套并行系统** | 单一 Middleware 接口 |
| **中间件链** | MiddlewareChain（6 阶段，8 个内置中间件） | 责任链模式，6 阶段（BeforeAgent / BeforeModel / AfterModel / BeforeTool / AfterTool / AfterAgent） |
| **Hook 系统** | HookRegistry（PreAgent / PostAgent / PreToolUse / PostToolUse，含 Command / Prompt / Agent hook 类型，20+ token 清洗模式） | 无独立 Hook 系统 |
| **短路机制** | 两套系统各自支持 | 错误时短路 |
| **认知成本** | 双系统增加理解成本 | **Go 更统一** |
| **能力上限** | JS 能力更强 | 覆盖基本场景 |

---

## 四、工具系统

| 维度 | js/agents | agentsdk-go |
|------|-----------|-------------|
| **工具接口** | ToolRegistry + hooks + quota + archive | Tool 接口 4 个方法 |
| **注册中心** | 带 Hook、配额、归档的完整注册表 | 线程安全 Map |
| **执行器** | ToolExecutor + Worker 隔离（Node + Browser） | Permission → Schema → Execute 顺序执行 |
| **内置工具** | TaskTool / BacktrackTool / DMailTool / RecallTool | 无内置工具 |
| **配额管理** | ToolQuotaManager | 无 |
| **平台工具** | 平台工具 + Python 运行时（Pyodide + SRI） | 无 |
| **结论** | JS 工具生态远超 Go | Go 接口简洁 |

---

## 五、安全与沙箱

| 维度 | js/agents | agentsdk-go |
|------|-----------|-------------|
| **整体架构** | **三层实际代码隔离** | 沙箱策略检查（FS / Net / Resource） |
| **L1 WASM** | QuickJS VM，能力白名单，NetworkPolicy，池化 | 无 |
| **L2 Browser** | iframe / Worker / eval + Proxy | 无 |
| **L3 System** | Bubblewrap（Linux namespace + seccomp）、Seatbelt（macOS SBPL）、Docker | 无 |
| **命令分类** | command-classifier（fork bomb 6 变体，17 敏感路径） | 无 |
| **Hook 清洗** | hook-runner（20+ token 清洗模式） | 无 |
| **策略引擎** | wildcard / glob / time-window / domain / composite 规则 | Security Validator（黑名单 + 危险参数检测） |
| **结论** | **JS 在安全/沙箱维度远超 Go** | 仅基础策略检查 |

---

## 六、多 Agent 协作

| 维度 | js/agents | agentsdk-go |
|------|-----------|-------------|
| **架构** | 完整协议栈 | SubagentManager（Definition + Handler + Dispatch），单层 |
| **注册与发现** | AgentRegistry（4 种类型，4 种状态） | 无 |
| **协调** | AgentCoordinator（Leader Election + 心跳 + 故障转移） | 无 |
| **任务板** | SharedTaskBoard（原子任务认领） | 无 |
| **消息协议** | agent-message 协议 + RPC | 无 |
| **追踪** | W3C Trace Context 传播 | 无 |
| **跨标签页** | TabCoordinator（BroadcastChannel） | 不适用 |
| **跨进程** | ProcessCoordinator（cluster IPC） | 不适用 |
| **结论** | **JS 多 Agent 协作能力远超 Go** | 满足基本子 Agent 调度 |

---

## 七、状态管理与持久化

| 维度 | js/agents | agentsdk-go |
|------|-----------|-------------|
| **总线系统** | 四总线：EventBus（Lamport Clock）、StateBus（响应式订阅）、ServiceBus（retry/cache 代理）、MessageBus（RPC） | 无 |
| **内存状态** | 四总线联动 | Context（Values map + ToolResults），History + RWMutex |
| **归档** | Archive（JSON Patch 增量快照 + IndexedDB） | 无持久化 |
| **CRDT** | 5 种类型：LWW-Register / GCounter / PNCounter / LWW-Map / OR-Set + SyncManager + WebSocket 传输 | 无 |
| **运行存储** | RunStore（IndexedDB + 配额管理 + 自动清理） | 无 |
| **结论** | **JS 状态管理和持久化体系完整** | 纯内存，无持久化 |

---

## 八、LLM 调用

| 维度 | js/agents | agentsdk-go |
|------|-----------|-------------|
| **接口** | ModelRouter 多供应商 | Model 接口（Complete / CompleteStream） |
| **供应商** | OpenAI / Anthropic / Gemini / Whisper / Image | 单供应商（Anthropic） |
| **路由策略** | usage-tag 路由 + round-robin | 无 |
| **速率限制** | TokenBucketRateLimiter（burst + 并发 + 死锁检测） | 无 |
| **熔断** | CircuitBreaker + 健康管理 | 无 |
| **错误处理** | 错误清洗 + Token 溢出恢复 | 基础错误处理 |
| **上下文压缩** | Cicada + Watchdog | 无 |
| **结论** | JS 的 LLM 调用链路成熟度远高于 Go | Go 接口简洁，单供应商足够 |

---

## 九、文档处理与检索

| 维度 | js/agents | agentsdk-go |
|------|-----------|-------------|
| **摄取** | PDF / DOCX / PPTX / HTML / Markdown / EPUB / Audio / Video / Code 适配器，OCR，ZIP 炸弹防护 | 无（不在 SDK 范围内） |
| **检索** | BM25 + Vector + Grep，Hybrid RRF 融合，MMR 多样性重排 | 无 |
| **文件系统** | VFS（Memory / OPFS / Storage / Node，符号链接，delta-sync，Web Locks） | 无 |
| **结论** | **JS 独有能力**，Go 不涉及此领域 | 超出 SDK 定位 |

---

## 十、浏览器运行时

| 维度 | js/agents | agentsdk-go |
|------|-----------|-------------|
| **Node 兼容层** | node-compat（约 70 文件，30+ 核心模块 shim，CommonJS require()，浏览器 npm 包管理器） | 无（编译为二进制） |
| **Web 运行时** | webruntime（DevServer、HMR、Service Worker 桥接、Worker RPC、VFS 快照） | 无 |
| **沙箱运行时** | WASM QuickJS + 系统沙箱 | 无 |
| **结论** | **JS 独有能力**，使浏览器成为完整运行时 | 不适用 |

---

## 十一、插件与扩展

| 维度 | js/agents | agentsdk-go |
|------|-----------|-------------|
| **插件系统** | PluginManager（拓扑排序、依赖检查、作用域隔离） | 无插件系统 |
| **安全加载** | SecurePluginLoader（SRI 校验） | 无 |
| **预设** | minimal → standard → deepsearch → production | 无 |
| **生产插件** | 12 个：compression / memory / telemetry / checkpoints / analysis / coordination / policy / resilience / side-effects / plan / deps / transports | 无 |
| **扩展方式** | 插件注册 + 预设组合 | 接口实现 + 函数式选项 |
| **结论** | JS 插件生态完整 | Go 通过接口组合扩展，简洁但能力有限 |

---

## 十二、业务 Stage

| 维度 | js/agents | agentsdk-go |
|------|-----------|-------------|
| **DeepSearch** | 66 文件，3 阶段循环，16+ 工具，收敛检测 | 无（仅 SDK） |
| **Design** | 64 文件，7 阶段流水线，Style Lock，3 级降级 | 无 |
| **CodeSearch** | 15 文件，Tree-sitter 符号索引 | 无 |
| **TextPrep** | 7 文件，TP1-TP6 流水线，Hard Gates | 无 |
| **结论** | **JS 独有能力**，Go 作为 SDK 不包含业务 Stage | 超出 SDK 定位 |

---

## 十三、测试与评估

| 维度 | js/agents | agentsdk-go |
|------|-----------|-------------|
| **Mock 体系** | MockModelClient / MockMcpProvider / ScenarioRunner | 标准 Go testing |
| **评估框架** | EvalHarness、GraderRegistry（deterministic / content / llm-judge / composite graders） | 无 |
| **DI 测试** | DI test container | 无 |
| **结论** | JS 测试与评估体系更完整 | Go 标准测试足够，但无评估框架 |

---

## 十四、总结表

| 能力维度 | js/agents | agentsdk-go | 优势方 |
|----------|-----------|-------------|--------|
| Agent 循环 | 中间件洋葱模型 | 简单 for 循环 | Go（透明性） |
| 中间件/拦截 | 双系统并行 | 单一接口 | 各有千秋 |
| 工具系统 | 完整生态 | 4 方法接口 | JS |
| 安全/沙箱 | 三层隔离 | 策略检查 | **JS 远超** |
| 多 Agent 协作 | 完整协议栈 | 单层调度 | **JS 远超** |
| CRDT/状态 | 四总线 + CRDT + 持久化 | 纯内存 | **JS 远超** |
| 浏览器运行时 | 完整 shim 层 | 不适用 | **JS 独有** |
| 文档处理/检索 | 全格式摄取 + 混合检索 | 不涉及 | **JS 独有** |
| LLM 调用 | 多供应商 + 熔断 + 压缩 | 单供应商 | JS |
| 插件系统 | 12 个生产插件 | 接口组合 | JS |
| 业务 Stage | 4 个完整 Stage | 不涉及 | **JS 独有** |
| 接口简洁性 | 复杂度较高 | 极简 | **Go 胜出** |
| 类型安全 | JSDoc 运行时 | 编译期 | **Go 胜出** |
| 代码质量均匀度 | 模块间差异较大 | 全局一致 | **Go 胜出** |
| 学习曲线 | 陡峭 | 平缓 | **Go 胜出** |

**核心结论**：两者是**互补关系**（浏览器应用平台 vs 后端 SDK），而非竞争关系。JS 在安全/沙箱、多 Agent、CRDT、浏览器运行时、文档处理方面远超 Go；Go 在接口简洁性、类型安全、质量均匀度、学习曲线方面胜出。
