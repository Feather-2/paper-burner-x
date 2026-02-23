# scripts/ 目录分层约定

为降低仓库噪音并支持后续跨项目能力抽取，`scripts/` 采用分层管理：

## 1) 核心工具（长期维护）

- `context-*.js`
- `dep-*.js`
- `issue-triage.js`

这些脚本属于五维工具链的稳定入口，应保持在 `scripts/` 根目录，便于 `npm scripts` 和文档直接引用。

## 2) 部署入口（项目运维）

- `deploy.sh`
- `deploy.ps1`
- `deploy-smart.sh`

这些脚本仍保留在根目录，兼容现有部署文档与人工运维习惯。

## 3) 一次性/历史脚本（低频使用）

已迁移到 `scripts/legacy/`：

- `apply-phase1-optimizations.js`
- `converge-utils.mjs`
- `fix-*.js`
- `migrate-to-vitest.js`
- `setup.sh`
- `test-scaffold.js`

`legacy` 脚本默认不作为日常入口；如需复用，请先评估是否应提升为核心工具并补齐文档。

## 4) 跨项目演进建议

后续将逐步把核心工具抽取为跨项目能力包（平台层），项目内保留轻量 wrapper + 配置。
