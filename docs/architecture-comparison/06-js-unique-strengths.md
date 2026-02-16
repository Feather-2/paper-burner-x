# js/agents 独有优势

> Date: 2026-02-15

## 1. 三层沙箱隔离 (core/sandbox/, 32 files, 6881 lines)

三层纵深防御架构：

- **L1 WASM QuickJS**：通过 WebAssembly 实现内存隔离，capability whitelist 控制可访问 API，NetworkPolicy 管控网络请求，Asyncify 支持异步操作，pool reuse 复用沙箱实例降低开销，SourceMap 支持调试映射。
- **L2 Browser**：iframe / Worker / eval+Proxy 三级降级方案，适配不同浏览器环境。
- **L3 System**：Bubblewrap（Linux namespace + seccomp BPF）、Seatbelt（macOS SBPL + mach-lookup 过滤）、Docker 容器隔离。

Go SDK 仅做 policy checks，无实际隔离执行环境。

## 2. CRDT 分布式状态 (core/crdt/, 11 files, ~2600 lines)

5 种 CRDT 类型：

- **LWW-Register**：Last-Writer-Wins 寄存器
- **G-Counter**：只增计数器
- **PN-Counter**：正负计数器
- **LWW-Map**：Last-Writer-Wins 映射
- **OR-Set**：Observed-Remove 集合

**CRDTDocument** 组合多种 CRDT 类型为复合文档。**SyncManager** 实现 incremental sync + snapshot fallback + offline queue 三级同步策略。WebSocket transport 支持 heartbeat + auto-reconnect。

支撑多标签页、多用户实时协作。Go SDK 无分布式状态能力。

## 3. 多Agent协作协议栈 (core/contracts/, 13 files, 2576 lines)

- **AgentRegistry**：4 种 Agent 类型，4 种生命周期状态
- **AgentCoordinator**：Leader Election、heartbeat 心跳、failover 故障转移
- **SharedTaskBoard**：原子任务认领（atomic claiming）
- **agent-message 协议**：task-request / result / status / knowledge 四类消息
- **RPC**：跨 Agent 远程调用
- **W3C Trace Context**：分布式追踪传播
- **TabCoordinator / ProcessCoordinator**：浏览器多标签页与多进程协调

Go SDK 仅有单层 SubagentManager。

## 4. Node.js浏览器兼容层 (core/node-compat/, ~70 files, ~12K lines)

30+ Node.js 核心模块浏览器 shim：events / path / fs / http / crypto / stream / buffer / url / os / child_process / net 等。

- **CommonJS require()** 运行时模拟
- **浏览器 npm 包管理器**：dependency resolution、tarball extraction、topological install
- **兼容性评分**：量化评估 Node.js 包在浏览器中的可用程度

使 Node.js 生态的包可以直接在浏览器中运行。

## 5. 浏览器运行时 (core/webruntime/, 11 files, 1701 lines)

- **VFS-driven DevServer**：基于虚拟文件系统的开发服务器，支持 40+ MIME types
- **HMR**：import.meta.hot 热模块替换
- **Service Worker bridge**：离线缓存与请求拦截
- **Worker RPC**：Comlink 风格的 Worker 通信
- **VFS snapshots**：文件系统快照
- **沙箱部署**：CSP + CORS + COOP + COEP 安全头配置

## 6. 完整文档处理链路

**Ingest 摄取**：10+ 格式适配器（PDF / DOCX / PPTX / HTML / EPUB / Audio / Video / Code），OCR 光学字符识别，ZIP bomb protection 防解压炸弹。

**Retrieval 检索**：BM25（关键词） + Vector（语义） + Grep（模式匹配）混合检索，RRF（Reciprocal Rank Fusion）融合排序，MMR（Maximal Marginal Relevance）多样性重排。

**VFS 虚拟文件系统**：4 种后端（Memory / OPFS / IndexedDB / LocalStorage），symlinks 符号链接，delta-sync 增量同步，Web Locks 并发控制。

## 7. 多模型路由 (llm/, 18 files)

- **多供应商**：OpenAI / Anthropic / Gemini 统一接口
- **usage-tag 路由**：按用途标签分发到不同模型
- **round-robin**：负载均衡轮询
- **TokenBucket 速率限制**：带死锁检测的令牌桶限流
- **CircuitBreaker**：熔断器防止级联故障
- **健康管理**：provider 健康状态追踪
- **错误净化**：sanitize 敏感信息
- **Token overflow recovery**：上下文溢出自动恢复
- **Context compression**：上下文压缩降低 token 消耗

## 8. 插件生态 (plugins/, 12 production)

| 插件 | 能力 |
|------|------|
| **compression** | Cicada 压缩算法 + Watchdog 溢出监控 |
| **memory** | 3 层记忆（L0 工作记忆 / L1 短期 / L3 长期） |
| **telemetry** | token 计量 + cost 成本追踪 + trace 分布式追踪 |
| **checkpoints** | VFS 持久化检查点 |
| **analysis** | behavior fingerprint 行为指纹 + convergence 收敛检测 |
| **coordination** | Tab 多标签页 + Process 多进程协调 |
| **policy** | rule engine 规则引擎 + approval 审批流 |
| **resilience** | degradation matrix 降级矩阵 |
| **side-effects** | WAL journal 预写日志 |
| **plan** | structured planning 结构化规划 |
| **deps** | Python / Pyodide 依赖管理 |
| **transports** | stdio JSONL + binary skills 传输层 |

## 9. 业务Stage

- **DeepSearch**（66 files）：3 阶段文档分析，16+ 工具，convergence detection 收敛检测，backtracking 回溯搜索。
- **Design**（64 files）：7 阶段 PPT 生成流水线，Style Lock 风格锁定机制。
- **CodeSearch**：Tree-sitter 符号索引，语义代码检索。
- **TextPrep**：TP1-TP6 六阶段内容处理流水线。

## 10. 评估框架 (eval/, 8 files)

**EvalHarness** 支持 multi-trial 多次试验。**GraderRegistry** 管理 4 种评分器：

- **deterministic**：确定性精确匹配
- **content**：内容关键词 / 模式匹配
- **llm-judge**：LLM 作为评审
- **composite**：多评分器组合

实现系统化 Agent 质量度量。

## 11. DI容器 (core/di/, 5 files, 1006 lines)

轻量级 IoC 容器：

- **SINGLETON / TRANSIENT** 两种作用域
- **70+ 默认服务注册**
- **Lazy instantiation** 延迟实例化
- **Parent-child containers** 父子容器，便于测试隔离

## 12. Archive持久化 (core/archive/, 7 files, 1334 lines)

- **JSON Patch delta snapshots**：基于 RFC 6902 的增量快照
- **IndexedDB adapter with fallback**：持久化存储带降级方案
- **Checkpoint schema**：带版本号和迁移支持的检查点 schema
- **Recovery cache**：故障恢复缓存

## 总结

以上 12 项能力合计 **~50K+ 行生产代码**，这些是 agentsdk-go 所不具备也不需要的（定位不同）。它们使 js/agents 从一个 Agent SDK 升级为一个**完整的 AI 应用平台**——可以在浏览器中独立运行，覆盖从文档摄取、智能检索、多模型调度、多 Agent 协作、分布式状态同步到最终内容产出（PPT/报告）的全链路。
