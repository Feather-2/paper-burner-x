# Code Review 已实现项目清单

本文档记录从 CODE_REVIEW.md 中已经实现和修复的项目。

**最后更新：** 2025-11-02

**最新更新（2025-11-01）：**
- 安全：移除返回明文 API Key 的接口，避免潜在密钥泄露。
  - 变更：删除 `GET /api/user/api-keys/:id/decrypt`（文件：`server/src/routes/user.js`）。
- 管理配置：完善系统配置白名单，前端保存不再失败。
  - 变更：允许 `WORKER_PROXY_DOMAINS` 键写入（文件：`server/src/routes/admin.js`）。
- 配额：新增“每日文档”配额校验，与月度配额并行生效。
  - 变更：`checkQuota()` 增加当日计数限制（文件：`server/src/utils/quota.js`）。
- 管理面板：提升网络健壮性与易用性。
  - 变更：`axios` 全局 15s 超时，GET 网络/超时自动重试 1 次；离线横幅与 Toast 统一错误提示；修复用户下拉解析；支持读取/保存 `ALLOW_REGISTRATION` 与 `MAX_UPLOAD_SIZE_MB`（文件：`admin/admin-enhanced.js`）。
- 环境变量校验：生产环境 Fail-fast 与友好告警。
  - 变更：生产强制 `JWT_SECRET/ENCRYPTION_SECRET`；建议项（`DATABASE_URL/CORS_ORIGIN/UPLOAD_STORAGE/MAX_UPLOAD_SIZE`）缺失给出警告（文件：`server/src/utils/env.js`）。
- 测试：最小鉴权回归用例，覆盖管理端基础安全门槛。
  - 变更：新增 `server/test/admin-auth.test.js` 确保无令牌访问 `/api/admin/*` 返回 401/403。

- 已增强 admin.js 的 SQL 注入防护和输入验证
- 已为 document.js 添加 UUID 验证和状态值白名单

---

## 最新更新（2025-11-02）

### 后端（Admin 统计加强 + 缓存与限流）

- 统计正确性与筛选：
  - 修复 Prisma `groupBy` 计数与排序（`_count: { _all: true }`；Top 用户以 `_count._all` 排序）。
  - `GET /api/admin/stats/detailed` 与 `GET /api/admin/stats/trends` 支持 `startDate`/`endDate` 日期范围；新增范围合法性校验（start<=end 返回 200，否则 400）。
  - 保持“今日/本周/本月”卡片仍按自然窗口统计。
- 只读限流：
  - 为统计/趋势接口新增只读限流（默认 60s 内 120 次），可通过 `ADMIN_READ_LIMIT_WINDOW_MS`、`ADMIN_READ_LIMIT_MAX` 调整。
- 短 TTL 缓存 + 多实例失效：
  - 统计/趋势接口增加短 TTL 缓存（默认 60s，`ADMIN_STATS_CACHE_TTL_MS` 可调）。
  - 新增全局 epoch 失效机制：写操作后原子递增 epoch（有 `REDIS_URL` 则用 Redis INCR；否则内存 Map），无需扫描删除键即可跨实例一致失效。
  - 新增 `server/src/utils/cache.js`（进程内缓存；有 Redis 自动使用，失败降级）。

### 前端管理面板（不影响直出）

- 概览页增强：
  - 日期筛选控件、当前筛选提示；URL hash 持久化；刷新/分享链接后保留选择。
  - 概览/趋势图按日期范围联动。
- 渐进模块化：
  - 新增 `admin/modules/{stats,activity,quotas,system}.js`，并在 `admin/admin-enhanced.js` 中动态导入，保留现有 onclick 与直出模式。
  - onclick 传参增加引号转义，防止属性破坏与潜在 XSS。
- 可选 Vite：
  - 根目录新增 `vite.config.js` 与脚本（`dev:fe/build:fe/preview:fe`）；默认不改 HTML 引用，保持开箱即用。

### OpenAPI 与 CI

- 文档：
  - `docs/openapi.yaml`（OpenAPI 3.1；`servers: /api`），最小覆盖：
    - Admin：users（列表/创建/更新/删除/状态/密码）、config（读/写）、source-sites（增删改查）、users/{id}/quota（读/写）、users/{id}/activity、stats detailed/trends。
  - `server/package.json` 增加 `openapi:validate`（语法校验）。
- CI：
  - 新增 `.github/workflows/ci.yml`，执行 Lint + OpenAPI 校验 + Jest 基础测试。
- 测试：
  - `server/test/admin-stats.test.js`（未授权/参数错误/日期范围 400 等基础回归）。
  - `server/test/admin-stats-authflow.test.js`（注册→登录→访问受限接口；使用一次性随机密码，避免密钥误报）。

---

## ✅ P0 优先级（必须立即修复的安全问题）

### 1. ✅ 硬编码的默认密钥（Critical）

**状态：** 已修复

**实现位置：**
- `server/src/middleware/auth.js` - JWT 密钥生成逻辑
- `server/src/routes/auth.js` - 统一 JWT 密钥管理
- `server/src/utils/crypto.js` - 加密 salt 管理

**实现内容：**
- 生产环境强制要求设置 `JWT_SECRET` 环境变量
- 开发环境自动生成随机密钥并给出警告
- 加密 salt 使用环境变量或开发环境固定值
- 启动时根据环境给出明确的安全提示

**相关文件：**
- `server/src/middleware/auth.js`
- `server/src/routes/auth.js`
- `server/src/utils/crypto.js`
- `server/ENV_CONFIG.md`（环境变量配置文档）

---

### 2. ✅ CORS 配置需要环境区分

**状态：** 已修复

**实现位置：**
- `server/src/index.js`

**实现内容：**
- 解决了 `credentials: true` + `origin: '*'` 的浏览器冲突
- 智能 CORS 配置：生产环境默认限制为同源，开发/前端模式允许所有源
- 支持逗号分隔的多个源配置
- 根据环境给出明确的警告提示

**相关文件：**
- `server/src/index.js`

---

### 3. ✅ 加密密钥派生使用固定 Salt

**状态：** 已修复

**实现位置：**
- `server/src/utils/crypto.js`

**实现内容：**
- 生产环境强制要求设置 `ENCRYPTION_SALT` 环境变量
- 开发环境使用固定 salt（便于开发），但给出警告提示
- 使用环境变量或开发环境固定 salt

**相关文件：**
- `server/src/utils/crypto.js`
- `server/ENV_CONFIG.md`

---

## ✅ P1 优先级（建议改进 - 可渐进式实施）

### 4. ✅ 密码强度验证和输入验证

**状态：** 已实现

**实现位置：**
- `server/src/utils/validation.js`（新建）
- `server/src/routes/auth.js`（集成验证）

**实现内容：**
- 创建验证工具模块 `validation.js`
- 实现密码强度验证（长度、字母、数字要求）
- 实现邮箱格式验证
- 在注册路由中集成输入验证
- 使用常量替换魔法数字（`VALIDATION` 常量）

**相关文件：**
- `server/src/utils/validation.js`
- `server/src/routes/auth.js`
- `server/src/utils/constants.js`

---

### 5. ✅ Health 端点信息泄露

**状态：** 已优化

**实现位置：**
- `server/src/index.js`

**实现内容：**
- 根据环境返回不同详细程度的信息
- 生产环境仅返回基本状态，不暴露 CSP 配置详情
- 开发环境返回详细 CSP 配置信息便于调试

**相关文件：**
- `server/src/index.js`

---

### 6. ✅ 错误处理中间件改进

**状态：** 已改进

**实现位置：**
- `server/src/middleware/errorHandler.js`
- `server/src/utils/errors.js`（新建）

**实现内容：**
- 创建统一的 `AppError` 类
- 明确的环境检查，生产环境不返回 stack trace
- 支持 Prisma 错误自动转换
- 提供常用错误工厂函数（notFound, unauthorized, forbidden 等）
- 开发环境返回详细错误信息便于调试

**相关文件：**
- `server/src/middleware/errorHandler.js`
- `server/src/utils/errors.js`

---

### 7. ✅ 文件类型验证（可选，通过环境变量控制）

**状态：** 已实现

**实现位置：**
- `server/src/index.js`

**实现内容：**
- 通过 `FILE_VALIDATION_STRICT` 环境变量控制验证严格程度
- 支持自定义文件类型白名单（`ALLOWED_MIME_TYPES`）
- 默认宽松模式保持前端模式灵活性
- 生产环境建议启用严格模式

**相关文件：**
- `server/src/index.js`

---

## ✅ 代码质量问题

### 12. ✅ 代码重复 - 统一错误处理

**状态：** 已实现

**实现内容：**
- 创建统一的 `AppError` 类
- 统一错误处理中间件
- 在路由中使用 `AppErrors` 工厂函数替换重复的错误处理逻辑

**相关文件：**
- `server/src/utils/errors.js`
- `server/src/middleware/errorHandler.js`
- `server/src/routes/auth.js`（示例）
- `server/src/routes/document.js`（已优化）
- `server/src/routes/user.js`（已优化）

---

### 15. ✅ 魔法数字和字符串

**状态：** 已实现

**实现位置：**
- `server/src/utils/constants.js`（新建）

**实现内容：**
- 创建常量定义文件，集中管理魔法数字和字符串
- 包含 HTTP 状态码、分页、文件上传、验证、JWT、加密、配额、角色等常量
- 在多个文件中使用常量替换硬编码值

**相关文件：**
- `server/src/utils/constants.js`
- 多个使用常量的文件：
  - `server/src/utils/validation.js`
  - `server/src/routes/auth.js`
  - `server/src/routes/document.js`
  - `server/src/routes/user.js`
  - `server/src/utils/crypto.js`
  - `server/src/utils/initAdmin.js`
  - `server/src/index.js`

---

### 16. ✅ 日志记录不充分

**状态：** 已实现

**实现位置：**
- `server/src/utils/logger.js`（新建）

**实现内容：**
- 创建结构化日志工具
- 支持日志级别控制（ERROR, WARN, INFO, DEBUG）
- 可通过环境变量 `LOG_LEVEL` 控制日志级别
- 提供请求日志辅助函数
- 支持结构化日志格式

**相关文件：**
- `server/src/utils/logger.js`

**注意：** 日志工具已创建，但尚未在所有文件中使用。建议后续逐步替换 `console.log` 为新的日志工具。

---

## ✅ 性能问题

### 17. ✅ 数据库连接池优化 - PrismaClient 单例

**状态：** 已实现

**实现位置：**
- `server/src/utils/prisma.js`（新建）

**实现内容：**
- 创建 PrismaClient 单例模式
- 避免多个实例导致数据库连接泄漏
- 更新所有路由文件使用统一实例（9个文件）
- 添加优雅关闭处理，确保连接正确释放
- 支持开发和生产环境的不同日志级别

**更新的文件：**
- `server/src/routes/auth.js`
- `server/src/routes/admin.js`
- `server/src/routes/user.js`
- `server/src/routes/document.js`
- `server/src/routes/chat.js`
- `server/src/routes/reference.js`
- `server/src/routes/prompt-pool.js`
- `server/src/utils/quota.js`
- `server/src/utils/initAdmin.js`

**相关文件：**
- `server/src/utils/prisma.js`

---

### 8. ✅ SQL 注入风险（Prisma 使用）

**状态：** 已加固

**实现位置：**
- `server/src/routes/admin.js`

**实现内容：**
- 添加排序字段白名单（`ALLOWED_SORT_FIELDS`）防止动态字段名注入
- 实现 `validateSortField()` 和 `validateSortOrder()` 函数
- 添加搜索字符串清理函数 `sanitizeSearchString()`
- 所有数据库查询都通过 Prisma 查询构建器，未发现原始 SQL 拼接

**相关文件：**
- `server/src/routes/admin.js`
- `server/src/utils/validation.js`（新增 `sanitizeSearchString`）

---

### 13. ✅ 缺少输入验证（部分实现）

**状态：** 部分实现

**实现位置：**
- `server/src/routes/auth.js` ✅
- `server/src/routes/admin.js` ✅
- `server/src/routes/document.js` ✅
- `server/src/routes/user.js` ✅

**实现内容：**
- 创建验证工具模块 `validation.js`，包含：
  - `validatePassword()` - 密码强度验证
  - `validateEmail()` - 邮箱格式验证
  - `validateRegisterData()` - 注册数据验证
  - `validateDate()` - 日期验证
  - `validateUUID()` - UUID 格式验证
  - `sanitizeSearchString()` - 搜索字符串清理
- admin.js 中添加：
  - 邮箱格式验证
  - 密码强度验证
  - 角色值白名单验证
  - 日期参数验证（days 范围 1-365）
  - 分页参数验证和限制
  - 布尔值类型验证
- document.js 中添加：
  - UUID 格式验证（所有路由）
  - 状态值白名单验证（`ALLOWED_STATUSES`）
  - 分页参数验证和规范化
- chat.js 中添加：
  - UUID 格式验证（所有路由）
  - 角色值白名单验证（`ALLOWED_ROLES`）
  - 日期参数验证
  - 内容长度限制（防止过大的消息）
  - 批量大小限制
- reference.js 中添加：
  - UUID 格式验证（所有路由）
  - 字符串长度限制（防止过大的数据）
  - 批量大小限制
- prompt-pool.js 中添加：
  - 数组类型验证
  - 数组大小限制（防止过大的数组）
  - 基本格式验证（保持宽松，兼容前端模式）

**待实现：**
- 其他路由文件的输入验证（已完成：chat.js, reference.js, prompt-pool.js ✅）

**相关文件：**
- `server/src/utils/validation.js`
- `server/src/routes/auth.js`
- `server/src/routes/admin.js`
- `server/src/routes/document.js`
- `server/src/routes/user.js`
- `server/src/routes/chat.js` ✅
- `server/src/routes/reference.js` ✅
- `server/src/routes/prompt-pool.js` ✅

---

## 📊 实现统计

- **P0 优先级：** 3/3 ✅ (100%)
- **P1 优先级：** 5/5 ✅ (100%) - 新增 SQL 注入防护
- **代码质量问题：** 4/6 ✅ (67%) - 新增输入验证改进（chat.js, reference.js, prompt-pool.js）
- **性能问题：** 1/4 ✅ (25%)

**总体进度：** 13/18 ✅ (约 72%)

---

## 📝 备注

- 本文件仅记录“已实现”的改动；未实现与待办请参见 CODE_REVIEW.md。

