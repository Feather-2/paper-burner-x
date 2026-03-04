# Sandbox Architecture Audit

> 审计对象：`js/agents/core/sandbox/`（含关联模块 `js/agents/skills/sandbox-adapter.js`、`js/agents/core/node-compat/sandbox-tool.js`）  
> 审计日期：2026-03-03  
> 审计范围：架构分层、降级链安全性、跨环境可行性、改进路径

## 一、架构验证结果

### 7 层架构分析

| 层级 | 模块 | 状态 | 结论 |
|---|---|---|---|
| Layer 1 基础隔离层 | `wasm-sandbox.js` / `iframe-sandbox.js` / `create-sandbox.js` | ⚠️ 代码存在（Node Worker 路径部分缺失；未完成端到端验证） | 覆盖 4 种后端，分级隔离能力需实测验证 |
| Layer 2 契约与配置层 | `sandbox-interface.js` | ⚠️ 代码存在（未完成端到端验证） | 已定义统一类型、级别、默认配置、auto 优先级，效果待验证 |
| Layer 3 统一工厂层 | `create-sandbox.js` | ⚠️ 代码存在（未完成端到端验证） | 已提供统一创建入口与自动降级路由，稳定性待验证 |
| Layer 4 资源池层 | `pool.js` | ⚠️ 代码存在（未完成端到端验证） | 包含资源复用、队列、监控、故障治理机制，运行表现待验证 |
| Layer 5 Skill 执行层 | `skill-executor-core.js` / `skill-sandbox.js` / `sandbox-adapter.js` | ⚠️ 代码存在（未完成端到端验证） | 已实现信任检查、能力裁剪与 fallback 编排，需验证可靠性 |
| Layer 6 Kernel 插件层 | `plugin.js` | ⚠️ 代码存在（未完成端到端验证） | 已向 Kernel 注册 sandbox 服务并管理生命周期，需验证集成稳定性 |
| Layer 7 工具层 | `sandbox-tool.js` | ⚠️ 代码存在（浏览器限定；未完成端到端验证） | 暴露 `execute_code` 工具，Node 侧禁用 host eval |

#### Layer 1（基础隔离层）验证

1. WASM (`wasm-sandbox.js`)
- 基于 QuickJS WASM VM，设计目标是提供 WASM + VM 双层边界隔离。
- 代码路径覆盖浏览器 + Node，缺少端到端验证数据。
- 证据：`js/agents/core/sandbox/wasm-sandbox.js:2`、`js/agents/core/sandbox/wasm-sandbox.js:4`

2. Iframe (`iframe-sandbox.js`)
- Cross-origin iframe 沙箱，依赖浏览器 DOM 环境。
- 仅浏览器可用。
- 证据：`js/agents/core/sandbox/create-sandbox.js:210`

3. Worker (`create-sandbox.js`)
- 浏览器使用 Web Worker（内部 `eval`，仅线程隔离，非安全隔离）。
- Node 路径明确未完成（直接抛错）。
- 证据：`js/agents/core/sandbox/create-sandbox.js:101`、`js/agents/core/sandbox/create-sandbox.js:115`

4. Main Thread (`create-sandbox.js` + `skill-sandbox.js`)
- `create-sandbox.js` 的主线程后端使用 `new Function`，且默认需要显式放开（`mainThreadFallback`）。
- Skill fallback 主线程路径使用 `new Function + with`，注释明确“不是安全边界”。
- 证据：`js/agents/core/sandbox/create-sandbox.js:236`、`js/agents/core/sandbox/create-sandbox.js:246`、`js/agents/core/sandbox/skill-sandbox.js:441`

#### Layer 3（统一工厂）验证

- `createSandboxFactory(config)` 提供统一入口，支持 `level=auto` 自动选择后端。
- `AUTO_PRIORITY = ['wasm', 'iframe', 'worker', 'main']`，自动降级链已在代码中定义，需运行验证。
- 证据：`js/agents/core/sandbox/create-sandbox.js:314`、`js/agents/core/sandbox/sandbox-interface.js:119`

#### Layer 4（资源池）验证

`pool.js` 代码包含资源管理机制，功能点较多，但缺少端到端验证，包含：

1. 按能力分组池化  
证据：`js/agents/core/sandbox/pool.js:42`

2. 并发控制（`maxActive`）  
证据：`js/agents/core/sandbox/pool.js:22`、`js/agents/core/sandbox/pool.js:135`

3. 优先级队列（高优先级优先 + 同级 FIFO）  
证据：`js/agents/core/sandbox/pool.js:123`、`js/agents/core/sandbox/pool.js:154`

4. 空闲超时回收  
证据：`js/agents/core/sandbox/pool.js:23`

5. 预热机制（`preWarmCount`）  
证据：`js/agents/core/sandbox/pool.js:28`、`js/agents/core/sandbox/pool.js:73`

6. 资源锁（多进程场景）  
证据：`js/agents/core/sandbox/pool.js:53`

7. 内存泄漏监控  
证据：`js/agents/core/sandbox/pool.js:61`

8. 连续失败熔断  
证据：`js/agents/core/sandbox/pool.js:25`、`js/agents/core/sandbox/pool.js:319`

#### Layer 5（Skill 执行层）验证

1. `skill-executor-core.js`
- 执行前信任检查、能力裁剪、限制策略计算。
- 处理 WASM 不可用和执行失败后的 fallback 入口。

2. `skill-sandbox.js`
- 管理降级执行链（Node worker/Web Worker → Main Thread）。
- 主线程 fallback 明确标注为 trusted-only/best-effort。

3. `sandbox-adapter.js`
- 作为 SkillsManager 的 drop-in adapter，对接既有 Skills 系统。

证据：`js/agents/core/sandbox/skill-executor-core.js:68`、`js/agents/core/sandbox/skill-sandbox.js:123`、`js/agents/skills/sandbox-adapter.js:23`

#### Layer 6（Kernel 插件）验证

- `plugin.js` 通过 `createPlugin` 注册 `sandbox` 服务，管理 install/uninstall 生命周期。
- 暴露执行、执行 skill、统计、清理等能力。
- 证据：`js/agents/core/sandbox/plugin.js:27`、`js/agents/core/sandbox/plugin.js:51`

#### Layer 7（工具层）验证

- `sandbox-tool.js` 暴露 `execute_code` 工具。
- 明确标记 `browserRequired: true`，Node 侧禁用 host eval。
- 证据：`js/agents/core/node-compat/sandbox-tool.js:57`、`js/agents/core/node-compat/sandbox-tool.js:60`

### 环境差异分析

1. 浏览器专用
- Iframe Sandbox（`iframe-sandbox.js`）
- `sandbox-tool.js`（`execute_code`）
- Web Worker fallback（`skill-sandbox.js` 的浏览器路径）

2. Node 专用
- System Sandbox（Bubblewrap / Seatbelt / Docker，位于 `js/agents/core/sandbox/system/`）
- worker_threads fallback（`skill-sandbox.js` 中 Node worker 路径）

3. 通用（Browser + Node）
- WASM Sandbox（QuickJS）
- SandboxPool
- SkillExecutor
- Sandbox Plugin

---

## 二、问题和风险点

### 1. 降级链的安全风险（严重）

问题表现：
1. 静默降级：`autoCreate()` 逐层尝试并吞并错误，调用方默认不知道最终落在哪一层。  
2. 安全性急剧下降：`WASM (强)` → `Iframe (较强)` → `Worker (eval, 中弱)` → `Main Thread (弱)`。  
3. Skill fallback 中主线程路径明确不是安全边界，但缺少统一的用户可见告警通道。

关键证据：
- `js/agents/core/sandbox/create-sandbox.js:290`（`autoCreate()` 静默降级循环）
- `js/agents/core/sandbox/skill-sandbox.js:441`（`executeFallbackInMainThread()`）
- `js/agents/core/sandbox/skill-sandbox.js:462`（注释：best-effort；不是强安全边界）
- `js/agents/core/sandbox/skill-sandbox.js:472`（注释：`with` 可被绕过）

### 2. Worker Sandbox 的 Node.js 路径未完成

问题表现：
- `create-sandbox.js` 的 Worker backend 在 Node 环境直接抛错，导致该分支在 Node 不可用。

关键证据：
- `js/agents/core/sandbox/create-sandbox.js:115`

影响：
1. Node 自动降级链在 Worker 层“断档”。  
2. Node 侧只能走 WASM 或（显式放开后）Main Thread。  
3. 与“多后端统一工厂”的一致性目标存在差距。

### 3. 文档和注释不够清晰

问题表现：
1. 用户/调用方很难一眼判断“当前执行后端与安全级别”。  
2. 缺少统一安全分级说明（例如 strict/safe/eval-only）。  
3. 缺少降级策略的使用指南与生产建议。

影响：
1. 误用风险上升。  
2. 线上问题难以快速定位（尤其是“同一代码在不同环境落到不同后端”）。

---

## 三、WASM 执行 JS 的可行性分析

### QuickJS WASM 的工作原理

1. QuickJS 是轻量 JS 引擎，可编译为 WASM 并在宿主中运行。  
2. 运行时隔离来自两层：
- WASM 内存边界（线性内存不可直接访问宿主对象）
- QuickJS VM 上下文边界（需显式注入能力）  
3. 可覆盖 ES2020 主体能力，适合“可控能力注入”的插件/脚本执行。

### 可行性评估

1. ⚠️ 原理可行
- QuickJS WASM 已广泛用于嵌入式脚本执行场景。

2. ⚠️ 性能具备可优化空间（需项目实测）
- 典型初始化开销在几十毫秒量级（常见约 ~50ms，取决于设备/包体/缓存）。
- 通过池化可显著摊薄冷启动。

3. ⚠️ 限制
- 不支持 DOM API（需宿主桥接注入）。  
- 需宿主实现能力白名单与资源限制。  
- 依赖 WebAssembly 运行时支持。

### 成熟产品的类似技术栈（概念对齐）

1. Figma：WASM/隔离运行插件逻辑（概念相近）。  
2. Shopify Oxygen：V8 Isolates（隔离执行范式相近）。  
3. Cloudflare Workers：V8 Isolates。  
4. Deno Deploy：V8 Isolates。  
5. StackBlitz WebContainers：WASM 运行 Node 兼容环境。  
6. CodeSandbox：iframe + Service Worker 组合隔离。  
7. Observable：iframe 沙箱执行用户代码。

### 成熟产品的额外适配与项目现状对比

#### 1. 成熟产品做了哪些额外适配

**StackBlitz WebContainers**：
- COOP/COEP Headers：必须设置 `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`，否则 `SharedArrayBuffer` 不可用。  
- Service Worker 拦截：用 SW 拦截 HTTP 请求，模拟本地服务器行为（`npm install`、模块加载都通过这个）。  
- WASM 冷启动优化：缓存编译后的 WASM 模块（`WebAssembly.compileStreaming` + Cache API）。  
- 自定义包管理器（Turbo）：在浏览器中运行的 npm 替代品。  
- 关键限制：最初只支持 Chrome（Firefox `SharedArrayBuffer` 支持滞后）；GitHub Pages 不支持 COOP/COEP headers。

**Figma**：
- 插件沙箱演进：iframe → Realms API（废弃）→ 自定义 JS 沙箱。  
- C++ 渲染引擎用 Emscripten 编译成 WASM。  
- `SharedArrayBuffer` 用于多线程渲染，同样要求 COOP/COEP headers。  
- 插件 API 桥接：只暴露有限 API 给插件代码（白名单模式）。

**CodeSandbox (Nodebox)**：
- 自研浏览器端 Node.js 运行时 Nodebox。  
- Worker 线程隔离 + 自定义模块打包/转译。  
- IndexedDB 持久化文件系统。  
- Service Worker 拦截网络请求。

#### 2. Paper-Burner 与成熟产品的完整对比

| 适配项 | StackBlitz | Figma | CodeSandbox | Paper-Burner | 验证状态 | 证据 |
|--------|-----------|-------|-------------|-------------|----------|------|
| COOP/COEP Headers | ✅ | ✅ | ⚠️ | ⚠️ 代码存在 | StackBlitz/Figma/CodeSandbox：生产验证；Paper-Burner：代码存在，未验证 | sandbox-deploy.js:230-232 |
| Service Worker 拦截 | ✅ | ❌ | ✅ | ⚠️ 代码存在 | StackBlitz/Figma/CodeSandbox：生产验证；Paper-Burner：代码存在，未验证 | sw-handler.js:37 |
| 虚拟 HTTP 服务器 | ✅ | ❌ | ✅ | ⚠️ 代码存在 | StackBlitz/Figma/CodeSandbox：生产验证；Paper-Burner：代码存在，未验证 | server-bridge.js:60 |
| SW 缓存策略 | ✅ | ✅ | ✅ | ⚠️ 代码存在 | StackBlitz/Figma/CodeSandbox：生产验证；Paper-Burner：代码存在，未验证 | sandbox-deploy.js:84-136 |
| CSP 策略 | ✅ | ✅ | ✅ | ⚠️ 代码存在 | StackBlitz/Figma/CodeSandbox：生产验证；Paper-Burner：代码存在，未验证 | sandbox-deploy.js:52-77 |
| 虚拟文件系统 | ✅ | ❌ | ✅ IndexedDB | ⚠️ VFS (Memory/OPFS/IDB) | StackBlitz/Figma/CodeSandbox：生产验证；Paper-Burner：代码存在，部分验证 | js/agents/vfs/ |
| Node 兼容层 | ✅ 完整 Node.js | ❌ | ✅ Nodebox | ⚠️ ~30 shims | StackBlitz/Figma/CodeSandbox：生产验证；Paper-Burner：代码存在，未验证 | js/agents/core/node-compat/ |
| API 白名单 | ✅ | ✅ | ✅ | ⚠️ capabilities | StackBlitz/Figma/CodeSandbox：生产验证；Paper-Burner：代码存在，未验证 | wasm-sandbox.js |
| 包管理器 | ✅ Turbo | ❌ | ✅ | ⚠️ npm/registry/tarball | StackBlitz/Figma/CodeSandbox：生产验证；Paper-Burner：代码存在，未验证 | js/agents/core/node-compat/npm/ |
| WASM 代码沙箱 | ❌ | ✅ (渲染引擎) | ❌ | ⚠️ QuickJS | StackBlitz/Figma/CodeSandbox：生产验证；Paper-Burner：代码存在，未验证 | wasm-sandbox.js |
| 部署配置生成 | ✅ | ✅ | ✅ | ⚠️ Vercel 配置生成 | StackBlitz/Figma/CodeSandbox：生产验证；Paper-Burner：代码存在，未验证 | sandbox-deploy.js |

结论：Paper-Burner 的功能清单覆盖面较广，但这不等于能力超集。成熟产品的可用性来自长期生产验证；Paper-Burner 当前仍以“代码存在，未完成端到端验证”为主。  
1. 与 StackBlitz/Figma/CodeSandbox 的差异主要是实现路线差异，不应直接下“更强”或“超集”结论。  
2. 功能条目越多，维护与安全复杂度越高，复杂度本身是工程负债。  
3. 对比结论应以端到端测试、回归结果与生产观测数据为准。
4. 覆盖条目数不是竞争力，验证通过率才是。

#### 3. 现状评估与下一步

项目在代码层面覆盖了多项成熟产品常见适配，但整体仍以“代码存在，未验证/部分验证”为主：解法存在，不代表已具备生产可用性。

方向上可继续推进，但距离生产可用仍有验证距离；需要先完成端到端验证，再判断收敛质量。

下一步行动：
1. 端到端验证：在浏览器中实际运行完整的 WASM 沙箱 + Service Worker + VFS + Node 兼容层链路。  
2. 修复验证中发现的问题。  
3. 基于验证结果更新本文档。

“以端到端验证结果说话，再讨论生产结论。”

---

## 四、Fallback 路径的实际可行性

### Iframe Fallback

1. ⚠️ 原理可行：Cross-origin iframe 可提供浏览器级隔离，但项目链路需端到端验证。  
2. ⚠️ 安全边界依赖 `sandbox` 属性与部署配置正确性，项目链路需验证。  
3. ⚠️ 限制：仅浏览器可用。

### Worker Fallback

1. ⚠️ 部分可行：浏览器路径基本完整。  
2. ❌ `create-sandbox.js` 的 Node Worker backend 未完成。  
3. ⚠️ 安全风险：若依赖 `eval`，本质上不是强安全边界。

### Main Thread Fallback

1. ❌ 不安全：`new Function` / `with` 无法形成可靠隔离边界。  
2. ❌ 可绕过：`Function.constructor`、`__proto__` 等路径可突破。  
3. ⚠️ 仅可作为最后可用性保障（trusted-only）。

### Node Compat 在浏览器的可行性

1. ⚠️ 代码路径可用：VFS + require shim + builtin shims 可提供 Node-like 体验，但需端到端验证。  
2. ⚠️ 限制：不支持 C++ addon 等原生模块。  
3. ⚠️ 性能：文件与模块解析经过 VFS/shim，有额外开销。

---

## 五、WASM 环境支持度

### 基本判断：WASM 的长期稳定性

1. ✅ WASM 1.0 是 W3C Recommendation（2019-12）。  
2. ✅ WASM 与 JavaScript 一样属于 Web 平台基础设施，通常保持向前兼容。  
3. ✅ 浏览器演进是增加能力（GC、Threads、SIMD），不是移除 WASM 基础支持。  
4. ⚠️ 未来版本大概率持续支持 WASM，但仍需在发布流程中持续做兼容性回归验证。

### 推荐最低环境（项目支持边界）

1. ⚠️ 建议边界：Chrome / Edge 110+（2023-02）  
2. ⚠️ 建议边界：Firefox 110+（2023-02）  
3. ⚠️ 建议边界：Safari 16.4+（2023-03）  
4. ⚠️ 建议边界：iOS Safari 16.4+（2023）  
5. ⚠️ 建议边界：Android Chrome 110+（2023）  
6. ⚠️ 策略建议：仅维护现代浏览器，不再适配 2017 年代老版本内核。

### 真正风险：降级路径而非 WASM 本身

1. ⚠️ `eval()` / `new Function()` 依赖 `unsafe-eval`，受 CSP 约束。  
2. ⚠️ 主流站点 CSP 趋严，`unsafe-eval` 被禁用的概率持续上升。  
3. ⚠️ Iframe sandbox 在 Chrome 114+ 的相关场景中更依赖 cross-origin isolation。  
4. ⚠️ Worker / Main Thread 的 eval 降级链，才是新版 Chrome 上更可能出问题的部分。

### 非目标平台（明确排除）

1. ❌ 微信小程序：WASM 能力不满足要求，不作为目标平台。  
2. ❌ 老旧国产浏览器：WASM / CSP / Worker 支持不完整，不作为目标平台。  
3. ⚠️ 若强行覆盖上述环境，只能使用 fallback，且安全边界明显下降。

### 成熟产品的实际做法（环境支持策略）

1. Figma：Chrome 90+、Firefox 90+、Safari 15+（近两年现代浏览器策略）。  
2. StackBlitz WebContainers：早期仅 Chrome，后扩展 Firefox（优先现代能力）。  
3. CodeSandbox：定位现代浏览器，不维护老旧内核兼容链。  
4. Notion：Chrome / Firefox / Safari 最新 -2 版本（滚动支持策略）。

### 结论

1. ⚠️ 当前已知主要风险在降级路径，结论需持续由实际运行数据验证。  
2. ⚠️ 项目应明确支持边界：Chrome/Edge 110+、Firefox 110+、Safari 16.4+。  
3. ⚠️ 老旧浏览器不作为目标，但需在文档与错误提示中明确说明。

---

## 六、架构适用场景

### 适合的场景

1. 浏览器环境 + 高安全要求  
- 首选 WASM Sandbox，其次 Iframe Sandbox。  
- 场景：在线代码编辑器、用户脚本执行。

2. Node.js 环境 + 系统级隔离  
- 使用 System Sandbox（Bubblewrap/Seatbelt/Docker）。  
- 场景：CI/CD、自动化审计、代码执行代理。

3. 高频执行 + 性能敏感  
- 使用 SandboxPool 复用实例。  
- 场景：实时执行、热重载、批量脚本。

4. Skills 系统  
- 使用 SkillExecutor + trustChecker + capability limits。  
- 场景：插件市场、扩展执行平台。

### 不适合的场景

1. 不支持 WASM 的运行时（如部分小程序容器）  
- 只能依赖 fallback，整体安全性下降。

2. 需要原生模块的场景  
- WASM 无法直接支持 C++ addons。  
- 更适合 System Sandbox。

3. 低频执行 + 严格内存受限  
- 池化收益可能低于管理开销。  
- 可考虑按需创建而非常驻池。

---

## 七、改进建议

### 立即可做（不破坏现有代码）

1. 添加降级事件
- 在 `create-sandbox.js` 的 `autoCreate()` 发射 `sandbox:fallback` 事件（或日志 hook）。
- 返回结构补充 `_sandbox.securityLevel`（例如 `strict|safe|risky|unsafe`）。

2. 创建 CLI 通知适配器
- 新增 `cli-notifier.js` 订阅降级事件，输出明确警告：
  - 当前后端
  - 触发降级原因
  - 安全级别变化

3. 完善文档
- 在 `js/agents/core/sandbox/CLAUDE.md` 增补安全级别说明与生产建议。
- 在 `create-sandbox.js` 顶部增加“降级链安全告警与配置建议”。

### 可选增强

1. 用户确认机制
- 当即将降级到 `worker/main/eval` 时，支持强制确认（可配置）。

2. 配置化降级策略预设
- `MINIMAL_PRESET`: 只允许 WASM，失败即报错。  
- `STANDARD_PRESET`: WASM + Iframe。  
- `PRODUCTION_PRESET`: 全链路可降级（但强告警）。

3. 完成 Worker Sandbox 的 Node.js 路径
- 在 `create-sandbox.js` 落实 `worker_threads` backend，补齐 create factory 一致性。

### 复杂度屏蔽

1. 通过配置开关控制复杂能力
- `pooling: true|false`
- `fallbackMode: 'none'|'safe'|'eval'`
- `resourceLock: true|false`

2. 文档化功能价值与开关方式
- 建议新增 `FEATURES.md`，按“收益/成本/默认值/推荐场景”组织。

3. 分支与版本策略
- 保留完整版本标签：`sandbox-full-v1.0`
- 如需收敛复杂度，建立 `feat/sandbox-minimal` 进行裁剪试验

---

## 八、总结

当前 7 层沙箱架构在代码层面覆盖面较广，但整体仍处于“功能存在、验证不足”的阶段。问题核心不只是层级数量，而是以下几点：

1. 降级链的安全风险（尤其静默降级）。  
2. Worker Sandbox 在 `create-sandbox.js` 的 Node 路径未完成。  
3. 文档与告警机制不足，导致调用方难以感知实际安全级别。  
4. 功能覆盖面广不等于生产可用，缺少端到端验证会放大误判风险。  
5. 复杂度本身是风险，模块越多越需要可观测性、回归与运维约束。

建议优先做“可观测性与策略化改进”（降级通知、文档、预设策略），并把端到端验证作为进入生产讨论的前置条件。
