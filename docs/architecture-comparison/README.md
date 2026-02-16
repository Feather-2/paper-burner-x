# js/agents vs agentsdk-go 架构对比与质量审计

> 生成日期: 2026-02-15
> 基于对 js/agents (544 文件, ~105K 行) 和 agentsdk-go (~60 文件, ~15K 行) 的全量深挖

## 文档索引

| 文档 | 内容 |
|------|------|
| [01-full-comparison.md](./01-full-comparison.md) | 完整能力维度对比 |
| [02-quality-ratings.md](./02-quality-ratings.md) | 模块质量评分与分布 |
| [03-open-issues.md](./03-open-issues.md) | 历史问题清单与修复状态（含行号） |
| [04-refactor-plan.md](./04-refactor-plan.md) | 重构路线图与实际收益 |
| [05-go-sdk-learnings.md](./05-go-sdk-learnings.md) | 从 agentsdk-go 可借鉴的设计 |
| [06-js-unique-strengths.md](./06-js-unique-strengths.md) | js/agents 独有优势 |

## 核心结论

- **agentsdk-go** 是精良的 Agent SDK — 接口极简、类型安全、质量均匀 (全栈 ⭐⭐⭐⭐)
- **js/agents** 是完整的 AI 应用平台 — 顶部 ⭐⭐⭐⭐⭐，基础模块与业务模块已全部收敛到 ⭐⭐⭐⭐ 及以上
- 两者是互补关系 (浏览器端平台 vs 后端 SDK)，不是竞品
- Phase 1-4 重构完成后，所有模块均达到 ⭐⭐⭐⭐ 及以上

## 修复状态

- 更新日期: 2026-02-16
- Phase 1-4 主修复提交: `d25aa0a8`
- 重命名与收尾提交: `dd8530fe`
