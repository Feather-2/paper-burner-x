# Paper Burner 代码审查报告（未完成项清单）

本文件仅保留“尚未完成/建议优化”的事项；所有已落地的改进请见 `CODE_REVIEW_IMPLEMENTED.md`。

## 近期路线与优先级（建议）

- P1（两周内）：
  - 前端构建优化与模块化拆分（Vite/ESM、懒加载、SRI）。
  - 缓存层与全局限流基座（可选 Redis，LRU 内存兜底）。
  - 流式化覆盖导出与大文件下载路径，统一清理策略。
  - 测试与 CI 基座（Jest + Supertest + GitHub Actions）。【进度】已新增最小管理端鉴权测试（server/test/admin-auth.test.js）。
- P2（四周内）：
  - 环境变量校验与安全基线（dotenv-safe/自检脚本）。
  - CSP 生产化（nonce/hash 策略矩阵）与健康检查增强。
  - 文档补全（OpenAPI 最小规范 + 开发/部署指引）。
- P3（中长期）：
  - 增量类型化（JSDoc/TS）与架构文档沉淀。

## 待处理问题（分组与编号对齐原审查项）

### 代码质量与可维护性

11) 前端全局变量与模块化（P1）
- 问题：`js/app.js`、`js/index.js` 等存在超长文件与大量 `window` 全局；依赖关系难追踪。
- 建议行动：
  - 引入最小构建链：优先 `Vite` + 原生 ESM，开发零配置；保留 `index.html` 直出模式的 fallback。
  - 拆分层次：`js/pages/*`（页面入口）、`js/components/*`（UI 组件）、`js/services/*`（API）、`js/store/*`（状态/缓存）、`js/utils/*`（工具）。
  - 入口统一：建立 `js/main.js` 作为页面动态入口；移除 `window.*` 暴露，改为命名导出。
  - 渐进迁移：先抽离服务层与工具层，再迁页面逻辑；保留过渡适配器以兼容旧调用。
  - 打包产物：`public/assets/*`，文件指纹与 SRI 校验可选启用。
  - 关联管理面板：`admin/admin-enhanced.js` 与 `admin/index.html` 按模块引入，新增的概览/配额/活动脚本独立模块化加载。
  - 近期补充：已在 `admin/admin-enhanced.js` 增加 axios 全局超时、离线横幅、GET 自动重试与统一错误提示，以提升网络不稳定场景可用性（非构建层变更）。
  - 涉及文件：`js/*.js`、`admin/admin-enhanced.js`、`admin/index.html`、新增 `vite.config.js`（可选）。
  - 验收：
    - 构建成功，页面功能不回退；`window` 全局暴露减少 ≥ 80%。
    - 首屏体积下降（目标：按路由懒加载，非必要模块异步）。
  - 风险/备注：
    - 第三方以全局变量注入的依赖需 shim；逐步替换为 ESM 包。
    - 构建路径与服务端静态资源路径需对齐（`express.static`）。

14) 异步错误处理不一致（P2）
- 问题：`.catch()` 与 `try/catch` 混用，错误处理分散。
- 建议行动：
  - 前端：新增 `js/utils/error.js`（标准化 `toUserMessage(err)`、`withToast(asyncFn)`、并发队列封装）。
  - 后端：统一使用 `AppError`（已建立），补齐路由缺口；为批量接口提供部分成功的结构化错误 `{ok:false, errors:[...]}`。
  - 验收：核心交互出现错误时统一 Toast 呈现；后端错误响应结构一致。
  - 风险/备注：前后端错误码与消息映射需列表化，避免散落写死。
  - 近期补充：前端已通过拦截器集中错误提示；后端继续推动 `AppErrors` 统一。

21) 代码组织与结构（P2）
- 建议行动：
  - 前端分层如 11) 所述；新增 `js/services/http.js`（带 Token、重试、节流）。
  - 后端：`server/src` 目录约定 `routes/`、`services/`、`middleware/`、`utils/`；跨路由逻辑上收敛到 `services/`。
  - 文档：在 `docs/architecture.md` 增补高层架构图与数据流示意。
  - 验收：模块边界清晰，跨模块只通过服务层通信；文档落地。

22) 类型化与可读性（P3）
- 建议行动：
  - 服务器端优先 JSDoc 注释 + VSCode 内联类型提示；为 `utils/`、`services/` 和公共 DTO 增加类型注释。
  - 若引入 TS，采用渐进方案：仅对 `server/src/utils/*.ts` 与 `server/src/services/*.ts` 建立 tsconfig 的 `allowJs` 模式。
  - 统一 ESLint 规则：`eslint:recommended` + `plugin:security/recommended`；前端加 `eslint-plugin-import`、`unused-imports`。
  - 验收：关键公共模块具备类型提示，无新增 any 污染；CI 执行 lint 通过。

24) 文档补全（P2）
- 建议行动：
  - OpenAPI 最小规范：新增 `docs/openapi.yaml`（从 `API_REFERENCE.md` 抽取），提供 `npm run openapi:validate` 校验脚本。
  - 前端开发指南：新增 `docs/frontend-guide.md`，涵盖模块化、构建、SRI 与懒加载约定。
  - 部署与安全：在 `QUICKSTART.md` 链接专节“安全基线”，列出最小必配 env 与生产开关。
  - 验收：OpenAPI 通过校验，核心路由具备契约；文档在 README 索引中可见。

25) 环境变量管理（P2）
- 现状：已有 .env.example（server）；已新增基本验证机制。
- 建议行动：
  - 新增 `server/src/utils/env.js`：集中读取与校验 env；生产环境缺失即启动失败，开发给出显著警告。【进度】已落地：生产强制 `JWT_SECRET/ENCRYPTION_SECRET`，建议项缺失警告。
  - 可选 `dotenv-safe`；或自研校验表，字段含：`ENCRYPTION_SECRET`、`JWT_SECRET`、`DATABASE_URL`、`MAX_UPLOAD_SIZE_MB`、`ALLOWED_ORIGINS` 等。
  - 更新 `.env.example` 与文档；在 `server/src/index.js` 入口最早引入校验。
  - 验收：启动时明确列出缺失项；生产环境不以默认值兜底。

### 性能与部署

18) 端到端大文件流式化覆盖（P2）
- 现状：OCR 上传已流式，建议梳理其余上传/下载/导出路径。
- 建议行动：
  - 统一导出下载路径为 `stream.DownloadService`（新建），`res` 级别使用 `pipeline` 与背压；大文件禁用一次性 `buffer` 聚合。
  - 临时文件目录采用 `server/tmp` + 定期清理（TTL，如 24h）；提供 `CLEANUP_INTERVAL_MINUTES` 与 `TMP_TTL_HOURS` 参数。
  - 结合配额：导出时统计 I/O 与大小，写入 `UsageLog`。
  - 验收：>100MB 文件导出稳定，内存峰值低于进程保守阈值（< 200MB）。
  - 风险/备注：Windows 与 Linux 路径差异；确保 `pipeline` 错误冒泡日志化。

19) 缓存层（P1）
- 建议行动：
  - 抽象 `Cache` 接口：`get/set/del/mget`；优先 `REDIS_URL` → Redis 实现，降级至 LRU（如 `lru-cache`）。
  - 缓存对象：系统配置、统计聚合（短 TTL 30–120s）、用户设置（60s）、热点列表；写操作后主动失效。
  - 与限流共享 Redis：统一连接与命名空间；暴露命中率与体积指标日志。
  - 验收：缓存命中率 > 60%（统计类），Redis 不可用时自动降级不影响功能。

20) 前端构建优化（P1）
- 建议行动：
  - 构建：开启 `esbuild`/`terser` 压缩与分包，`vite` Rollup 分块策略（vendor、ui、charts）。
  - 懒加载：基于路由/标签页动态 import（如 admin 的 概览/配额/活动）。
  - SRI：为 CDN 资源与打包产物生成 hash（可选 `vite-plugin-sri`）；`index.html` 注入 integrity。
  - 资源治理：启用 `eslint-plugin-import/no-unused-modules` 与 Bundle 分析；移除未使用依赖。
  - 验收：首屏 JS 体积下降 ≥ 30%；Lighthouse Performance 分数提升。

### 安全增强（中长期）

S1) CSP 生产化与最小授权（P2）
- 建议行动：
  - 使用 `helmet` 启用 CSP；提供 `CSP_MODE=nonce|hash|off` 与 `CSP_CONNECT_SRC` 可配置。
  - 生成请求级 `nonce` 注入到模板与内联脚本；前端去除内联事件处理，改为模块监听。
  - 维护策略矩阵：开发/生产不同白名单；尽可能最小化 `connect-src`。
  - 验收：生产环境内联脚本全部通过 nonce/hash；第三方仅白名单域访问。

S2) 全局级限流与配额策略（P2）
- 现状：OCR 专用限流已实现；配额已补强“每日文档数”校验（`checkQuota()`）。
- 建议行动：
  - 引入 `express-rate-limit` + Redis store（可选）；按 IP 与用户 Token 双维度限流。
  - 路由维度策略：认证/管理端更严格阈值；导出 `/metrics` 指标（可选 prom-client）。
  - 与 `quota.js` 协同：超阈值写入 `UsageLog`，便于审计与告警。
  - 验收：压测下限流命中与降级行为符合预期；未影响正常峰值流量。

S3) 健康检查增强（P3）
- 建议行动：
  - `GET /api/health`：`?verbose=1` 开启详细；生产默认简要（mask 敏感信息）。
  - 可选探针：数据库连接、Redis 可用性、磁盘余量、迁移状态；失败返回 503。
  - 验收：K8s/Docker 健康探针稳定；信息泄露风险受控。

### 工程与质量

Q1) 测试与 CI（P1）
- 建议行动：
  - 单测：`jest` + `supertest`，新增样例测试：auth、documents、admin 统计三个覆盖面。
  - 覆盖关键路径：加密/解密、配额拦截、权限校验、输入验证、统计聚合。
  - CI：GitHub Actions 工作流 `.github/workflows/ci.yml`（Node 版本矩阵、安装、lint、test）；可选缓存 `~/.npm`。
  - 验收：PR 必须通过 lint+test；基础用例覆盖率门槛（行覆盖 ≥ 40% 起步）。
  - 风险/备注：避免引入与数据库强耦合的大量集成测试，优先 fast tests；必要时使用 Prisma 的 SQLite/内存模式。

Q2) API 文档与契约测试（P2）
- 建议行动：
  - 从 `API_REFERENCE.md` 生成 `openapi.yaml`（最低：认证、文档 CRUD、配额、统计）；
  - 增加契约测试：根据 OpenAPI 校验响应 shape（如 `openapi-enforcer`/`zod-to-openapi` 反向校验）。
  - 验收：核心路径契约稳定；前端生成型客户端可选落地（如 openapi-typescript）。

## 建议路线图（按优先级）

1) P1：前端构建优化 + 缓存层 + 测试/CI 基座（管理端鉴权测试已添加）
2) P2：模块化重构、CSP 生产化、全局限流与健康检查增强、文档补全、环境变量校验
3) P3：类型化与架构文档完善

> 已完成的安全与功能改进，请见 CODE_REVIEW_IMPLEMENTED.md（动态代理白名单、OCR 代理加固与重试、磁盘上传、限流鉴权、配置掩码与校验、Admin UUID/源站管理、面板一键操作、移除明文 Key 接口、日配额校验、前端网络稳健性、env 校验与 admin 鉴权测试等）。

