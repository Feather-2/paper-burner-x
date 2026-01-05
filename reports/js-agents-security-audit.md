# js/agents 安全审计报告（含 stages 层）

日期：2026-01-05  
范围：`js/agents/**`（包含 `js/agents/stages/**`）  
环境：Node `v22.19.0`，npm `10.9.3`

## 1. 审计方法

- 代码层：对高风险 API/模式做定向检索（`fetch`、动态执行、`vm`、Worker 消息边界、文件系统读写、HTML 解析/拼接等）并人工走读关键调用链。
- 依赖层：`npm audit --registry=https://registry.npmjs.org`（以 npm 官方审计端点为准）。
- 回归：`npm run test:agents`（包含覆盖率门槛）。

## 2. 关键结论（摘要）

- 已修复：URL 校验的私网绕过（IPv6 `[]` 与 IPv4-mapped IPv6），以及 ingest 直连抓取缺少 URL 校验导致的 SSRF 面。
- 已加固：Python 依赖预加载从“执行任意 JS 脚本”切换为结构化 `loadPlan`；同时 wheel 缓存文件名净化。
- 已加固：JS 沙箱 Worker 的可用性（修复严格模式 + `with` 不兼容、Worker 超时后可自愈）。
- 待处理：`vite` 通过 `esbuild` 引入的已知漏洞需要升级到 `vite` 新大版本（会是破坏性变更）。
- stages 层更多属于“工程性风险”（重复造轮子、无限增长的 `Map`），但其中“无界缓存/Map”在浏览器长会话下可演化为可利用的内存 DoS。

## 3. 发现与修复

### F-01 SSRF/私网访问绕过（High，已修复）

**问题**  
`validateFetchUrl` 的私网拦截在以下情况失效：
- `URL.hostname` 带 IPv6 字面量括号（如 `"[::1]"`）时未去括号，导致无法识别回环/私网 IPv6。
- IPv4-mapped IPv6（如 `::ffff:127.0.0.1`）未被识别为私网。

此外，`ingest-stage` 在 `allowDirectUrlFetch` 路径会直接 `fetch(targetUrl)`，未统一复用 `validateFetchUrl`，扩大 SSRF 面。

**影响**  
在浏览器或 Node 环境中，只要允许直连抓取（或通过 MCP/代理链错误配置），就可能触发访问内网地址/元数据服务等行为；在浏览器场景更常见的影响是对本机/局域网服务的探测与读取。

**修复**  
- IPv6 私网识别增强（去 `[]`、识别 IPv4-mapped IPv6）：`js/agents/mcp/http-proxy.js:102`
- 直连抓取路径引入 `validateFetchUrl`：`js/agents/ingest/ingest-stage.js:16`
- 覆盖测试：`tests/agents/local-mcp-provider.test.js:723`

### F-02 Python 依赖预加载的代码注入面（High，已修复/缓解）

**问题**  
`python-runtime-worker` 的 `preload` 分支支持 `payload.loadScript`，并使用 `AsyncFunction` 执行 JS 字符串。只要攻击者能影响 `loadScript` 内容（例如通过不受信任的依赖声明/消息注入链路），就会把代码执行面扩大到 Worker 内。

**修复/缓解**  
- Worker 侧优先使用结构化 `loadPlan`（builtin/micropip/wheels），不再需要执行任意 JS：`js/agents/runtime/tools/python-runtime-worker.js:106`
- 主线程新增 `PythonRuntimeAdapter.preloadPlan`：`js/agents/runtime/core/python-adapter.js:69`
- PythonSkillExecutor 改用 `preloadPlan`（彻底绕开 `loadScript` 路径）：`js/agents/runtime/deps/python-skill-executor.js:74`
- Wheel 缓存文件名净化，避免 URL query/非法字符带来的路径问题：`js/agents/runtime/deps/dependency-manager.js:51`
- `DependencyManager.generateLoadScript` 同步改为“无插值”的安全脚本生成方式（兼容旧路径时也避免把依赖内容拼进代码）：`js/agents/runtime/deps/dependency-manager.js:243`

### F-03 JS Sandbox Worker 可用性/DoS（Medium，已修复/缓解）

**问题**  
- `js-sandbox-worker` 里拼接的执行包装含 `"use strict"` 且使用 `with`，在现代 JS 环境中会直接语法错误，导致沙箱不可用并触发 fallback（主线程执行）。
- Worker 超时后若遇到同步死循环，单纯 Promise 超时并不能终止 Worker，可能导致沙箱线程永久卡死。

**修复/缓解**  
- 移除严格模式并保证 `this` 绑定到受限对象；同时 best-effort 遮蔽常见逃逸入口：`js/agents/runtime/core/js-sandbox-worker.js:21`
- Worker 超时后主动 `terminate()` 并清空引用，避免沙箱“卡死不可恢复”：`js/agents/runtime/core/js-adapter.js:109`

**备注（重要）**  
该沙箱仍然不是强安全边界（`new Function`/黑名单检测属于“误用防护”，不是隔离器）。如果有“执行不可信 JS 代码”的强需求，建议引入 QuickJS/SES 或真正的隔离方案。

### F-04 供应链：Pyodide CDN 动态加载缺少完整性校验（Medium，未修复）

- `python-runtime-worker` 从 `cdn.jsdelivr.net` 动态 `import()` Pyodide 模块：`js/agents/runtime/tools/python-runtime-worker.js:24`
- 风险：CDN 劫持/投毒、版本漂移或中间人攻击都会直接变成执行任意代码。
- 建议：引入 SRI/内容哈希校验，或将 Pyodide 资源随产物本地打包并锁定版本（文件里已有 TODO）。

### F-05 stages 层工程性风险（Medium/Low，未修复）

> 这部分更偏“可靠性/可维护性”，但在浏览器长会话下会演化为安全风险（尤其是内存 DoS）。

**现状量化（可复现）**
- `stages/` 下 JS 文件数：130  
  - 复现：`find js/agents/stages -type f -name '*.js' | wc -l`
- `new Map(` 出现次数：74（多处无界增长）  
  - 复现：`rg -n "new Map\\(" js/agents/stages | wc -l`
- runtime 现成组件在 stages 中几乎未复用：`lru-cache`/`circuit-breaker`/`token-cache`/`schema-validator` 在 stages 内引用为 0；`cancellation.js` 仅 1 处引用  
  - 复现：`rg -n "lru-cache\\.js" js/agents/stages | wc -l` 等

**重复模块**
- error-classifier：`js/agents/stages/design/shared/error-classifier.js` 与 `js/agents/stages/deepsearch/runtime/error-classifier.js`
- limiter：`js/agents/stages/design/shared/limiter.js` 与 runtime 的 `ResourceGuard`（`js/agents/runtime/core/resource-guard.js`）
- 工具函数重复：例如 `toPositiveInt` 在 stages 内多处定义（`rg -n "function toPositiveInt\\b" js/agents/stages`）

**建议（浏览器端优先）**
- P0：合并 error-classifier 到共享位置（建议在 `js/agents/shared/utils/` 建立统一分类器并逐步迁移）
- P1：用 `js/agents/shared/utils/lru-cache.js` 替换“无界 Map 缓存”，对长会话/多轮运行设置上限
- P1：用 `js/agents/runtime/core/resource-guard.js` 替换自实现 limiter，统一并发与配额策略
- P2：接入 `js/agents/runtime/telemetry/token-tracker.js`（若希望对 LLM 调用做成本/延迟可观测）

## 4. 依赖审计（未完全解决）

- `npm audit`（npm 官方端点）报告：`esbuild <= 0.24.2`（经 `vite@5.x` 引入）  
  - 修复路径：升级到 `vite` 新大版本（`npm audit fix --force` 会触发破坏性升级）
  - 评估建议：若生产环境不暴露 dev server，则风险通常集中在开发态；仍建议制定升级计划或使用 override/resolution 策略评估可行性。

## 5. 已验证

- `npm run test:agents`：全通过（含覆盖率门槛）

