# Paper Burner X — AGENTS.md（面向智能代理）

本文件为仓库内的智能代理（Coding Agent）提供工作约定与当前项目进度说明。其作用域为仓库根目录起的整个目录树。

## 沟通与协作约定
- 必须使用中文与维护者交流（简体中文）。
- 保持简洁、直接、友好，优先给出可执行的下一步指导。
- 在进行多步或复杂改动前，先给出简短计划（使用计划工具/步骤列表）。
- 对大文件或多文件改动，先说明范围与目的，再动手。
- 严禁泄露任何敏感信息（如真实 API Key、私密配置）；仅以占位符或示例名展示。
- 命令、路径、代码标识使用反引号包裹，例如 `npx prisma migrate deploy`、`server/src/utils/crypto.js`。

## 项目概述
- 名称：Paper Burner X
- 栈与组件：Node.js/Express + Prisma + PostgreSQL；前端为网页管理面板与业务页面。
- 目标：多用户（多租户）支持、全量持久化、安全加密、配额管理、统计分析、跨设备同步。

## 当前进度（后端已完成，前端部分进行中）
已完成（核心）：
- 安全加密
  - API Keys 使用 AES-256-GCM 加密存储，PBKDF2（100k）派生密钥（`server/src/utils/crypto.js`）。
  - `user.js` 路由已接入加密与 Key 状态管理。
- 数据持久化
  - 意群数据、标注数据完整 CRUD，文档所有权校验，多用户隔离（`server/src/routes/document.js` 等）。
  - 已处理文件记录（ProcessedFile）与批量检查、唯一约束。
- 配额与统计
  - 用户配额与用量日志（`server/src/utils/quota.js`）。
  - 详细统计、使用趋势、Top 活跃用户等管理端 API（`server/src/routes/admin.js`）。
- 数据库与文档
  - Prisma Schema 更新与迁移脚本：`server/prisma/migrations/002_add_processed_files_and_quotas/migration.sql`、`server/prisma/schema.prisma`。
  - 文档齐全：`API_REFERENCE.md`、`BACKEND_IMPROVEMENTS.md`、`QUICKSTART.md`、`SUMMARY.md`、`NEXT_STEPS.md`。

进行中 / 待办：
- 数据库迁移尚未执行到实际数据库（需 `npx prisma migrate deploy`）。
- 管理面板前端增强：
  - 已引入 `Chart.js` 与增强脚本 `admin/admin-enhanced.js`，并在 `admin/index.html` 中加载。
  - 但“概览/配额管理/活动日志”三个标签页与对应内容尚未实际插入到 `admin/index.html`（参考 `admin/README_NEW_TABS.md` 的片段）。
- 业务前端仍需迁移到新的后端 API（历史记录、标注、意群、已处理文件等从 IndexedDB/localStorage 过渡到服务端）。

## 建议下一步（优先级从高到低）
1. 集成管理面板新标签页与内容（依据 `admin/README_NEW_TABS.md`），并联调：
   - 概览：趋势图表、状态分布、Top 用户。
   - 配额管理：查看/设置/重置配额与用量进度条。
   - 活动日志：按用户与条数筛选查看。
2. 运行数据库迁移并验证：
   - `cd server && npm i`（若需要）
   - `npx prisma generate`
   - `npx prisma migrate deploy`
3. 后端本地验证关键 API（参考 `API_REFERENCE.md` 与 `NEXT_STEPS.md` 中的 curl 样例）。
4. 前端业务迁移：将历史记录、标注、意群、已处理文件等存取改为调用后端 API；提供一次性迁移脚本以迁出 IndexedDB 数据。
5. 管理面板 UI 细节与交互优化（加载状态、错误提示、表格分页/筛选等）。
6. 部署准备：配置 `ENCRYPTION_SECRET`，重启服务（详见 `QUICKSTART.md`）。

## 重要文件与路径（点击可打开）
- 管理面板（前端）：
  - `admin/index.html`（当前尚未包含新标签页内容）
  - `admin/admin-enhanced.js`（增强逻辑：配额/趋势/活动等）
  - `admin/README_NEW_TABS.md`（需插入的 HTML 片段）
- 规划与说明：
  - `NEXT_STEPS.md`
  - `API_REFERENCE.md`、`BACKEND_IMPROVEMENTS.md`、`QUICKSTART.md`、`SUMMARY.md`
- 后端代码：
  - 路由：`server/src/routes/admin.js`、`server/src/routes/document.js`、`server/src/routes/user.js`
  - 工具：`server/src/utils/crypto.js`、`server/src/utils/quota.js`
- 数据库：
  - `server/prisma/schema.prisma`
  - `server/prisma/migrations/002_add_processed_files_and_quotas/migration.sql`

## 开发与提交约定
- 遵循现有代码风格与模块划分，变更聚焦、最小必要。
- 仅修复与当前任务相关的问题；避免顺手大改无关代码。
- 修改前先快速检索相关文件；必要时查阅 `NEXT_STEPS.md` 与 API 文档。
- 提交信息使用中文并语义化（如 `feat:`、`fix:`、`docs:`、`refactor:`）。
- 禁止提交真实密钥或私密配置；示例配置放在 `.env.example`。

## 运行与验证（概览）
1. 进入后端目录：`cd server`
2. 安装/更新依赖：`npm install`
3. 生成 Prisma Client：`npx prisma generate`
4. 应用迁移：`npx prisma migrate deploy`
5. 启动服务：`npm start`
6. 参考 `API_REFERENCE.md` 进行接口验证；参考 `NEXT_STEPS.md` 进行端到端测试。

## 注意事项
- 与维护者的交流必须使用中文。
- 对潜在破坏性动作（如删除数据、重置配置），请先描述风险与备份方案，再执行。
- 新功能建议先以独立模块/文件实现，通过小步 PR/提交合并，降低回归风险。

更新时间：2025-10-17

