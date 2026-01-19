# js/agents 大文件清单

> 生成时间: 2026-01-19
> 阈值标准: 700 行软限制 / 1000 行硬限制

## 统计概览

| 阈值 | 文件数 | 说明 |
|------|--------|------|
| 500+ 行 | 78 | 参考值 |
| 600+ 行 | 47 | 参考值 |
| **700+ 行** | **36** | 软限制，需关注 |
| 800+ 行 | 24 | 较大 |
| 900+ 行 | 18 | 很大 |
| **1000+ 行** | **11** | 硬限制，应考虑拆分 |

## 行业标准参考

| 来源 | 建议行数 |
|------|----------|
| Clean Code (Uncle Bob) | 200-400 行 |
| ESLint max-lines 默认 | 300 行 |
| SonarQube | 500 行 |
| 实际大型项目 | 500-1000 行 |

---

## 1000+ 行文件 (11 个) - 硬限制

| 行数 | 文件 | 模块 | 说明 |
|------|------|------|------|
| 1655 | `plugins/memory/memory-store.impl.js` | memory | Memory 插件核心实现 |
| 1484 | `plugins/memory/unified-memory-store.js` | memory | 统一 Memory 存储层 |
| 1431 | `stages/design/agent-loop.js` | design | Design Stage 主循环 |
| 1356 | `stages/deepsearch/tools/write-report/handler.js` | deepsearch | 报告生成工具 |
| 1268 | `plugins/memory/state-engine.js` | memory | 状态引擎 |
| 1234 | `llm/model-router.js` | llm | LLM 多模型路由 |
| 1214 | `core/event-bus.js` | core | 事件总线 (Lamport Clock) |
| 1167 | `plugins/memory/l3-storage.js` | memory | L3 层存储 |
| 1136 | `storage/run-store.js` | storage | Run 存储管理 |
| 1016 | `runtime/core/agent-loop.js` | runtime | Agent 主循环基类 |
| 1002 | `shared/archive/archive.js` | shared | 归档检查点 |

### 拆分建议

| 文件 | 可拆分方向 |
|------|------------|
| `memory-store.impl.js` | 按层级拆分: L0/L1/L2/L3 |
| `design/agent-loop.js` | 拆出 phase 处理器 |
| `write-report/handler.js` | 拆出 citation/formatting |
| `model-router.js` | 拆出 rate-limit/fallback |
| `event-bus.js` | 拆出 lamport-clock/subscription |

---

## 700-999 行文件 (25 个) - 软限制

| 行数 | 文件 | 模块 |
|------|------|------|
| 996 | `runtime/core/orchestrator.js` | runtime |
| 980 | `core/sandbox/skill-executor.js` | core |
| 942 | `plugins/compression/impl/cicada-compressor.js` | compression |
| 936 | `mcp/smart-content-extractor.js` | mcp |
| 927 | `prompts/prompt-loader.js` | prompts |
| 926 | `mcp/mcp-nexus-provider.js` | mcp |
| 901 | `testing/mock-suite.js` | testing |
| 879 | `plugins/side-effects/side-effect-journal.js` | side-effects |
| 871 | `runtime/tools/tool-executor.js` | runtime |
| 854 | `runtime/core/message-manager.js` | runtime |
| 833 | `runtime/core/api/stage-api-factory.js` | runtime |
| 818 | `stages/codesearch/code-tools.js` | codesearch |
| 801 | `stages/design/generators/batch-generator.js` | design |
| 781 | `stages/design/internal/design-phases.js` | design |
| 779 | `stages/deepsearch/internal/shared-context.js` | deepsearch |
| 777 | `stages/design/refiner/react-refiner-tools.js` | design |
| 776 | `ingest/ingest-stage.js` | ingest |
| 772 | `vfs/operations.js` | vfs |
| 760 | `stages/deepsearch/report/report-generator.js` | deepsearch |
| 750 | `stages/deepsearch/phases/planning-phase.js` | deepsearch |
| 720 | `mcp/resource-manager.js` | mcp |
| 715 | `stages/design/generators/svg-generator.js` | design |
| 710 | `plugins/compression/impl/proactive-compressor.js` | compression |
| 709 | `stages/design/generators/image-generator.js` | design |
| 706 | `stages/deepsearch/deepsearch-agent-loop.js` | deepsearch |

---

## 按模块分布

| 模块 | 700+ 文件数 | 1000+ 文件数 |
|------|-------------|--------------|
| plugins/memory | 4 | 4 |
| stages/design | 6 | 1 |
| stages/deepsearch | 5 | 1 |
| runtime | 5 | 1 |
| mcp | 3 | 0 |
| core | 2 | 1 |
| plugins/compression | 2 | 0 |
| llm | 1 | 1 |
| storage | 1 | 1 |
| shared | 1 | 1 |
| 其他 | 6 | 0 |

---

## 更新日志

| 日期 | 更新 |
|------|------|
| 2026-01-19 | 初始版本，统计 700+/1000+ 大文件 |

## 拆分完成记录 (2026-01-20)

### 原 1000+ 行文件拆分结果

| 原文件 | 原行数 | 现行数 | 新模块 |
|--------|--------|--------|--------|
| memory-store.impl.js | 1655 | 2 | core + L0/L1/L2/L3 + utils |
| unified-memory-store.js | 1484 | 144 | query + write + index + lifecycle + utils |
| design/agent-loop.js | 1431 | 526 | phases/* + state-manager + tool-handler + deck-operations |
| write-report/handler.js | 1356 | 799 | citations + formatting + template |
| state-engine.js | 1268 | 540 | reducers + events + persistence + utils |
| model-router.js | 1234 | 356 | call-executor + config-parser + health-manager + fallback + provider-selection |
| event-bus.js | 1214 | 838 | event-record + subscriptions + utils |
| l3-storage.js | 1167 | 710 | storage-io + index-manager + query + tab-coordinator |
| run-store.js | 1136 | 209 | crud + queries + cache + utils |
| runtime/agent-loop.js | 1016 | 684 | message-handling + tool-dispatch + lifecycle-hooks |
| archive.js | 1002 | 309 | core + serialization + map-adapter |

**结果**: 11 个文件全部降到 1000 行以下，6 个降到 500 行以下。

Commit: `50e5d83`
