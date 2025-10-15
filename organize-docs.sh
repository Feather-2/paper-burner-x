#!/bin/bash

# 项目文档整理脚本

echo "整理项目文档..."

# 创建 docs 子目录
mkdir -p docs/deployment
mkdir -p docs/development
mkdir -p docs/legacy

# 移动部署文档
mv QUICKSTART.md docs/deployment/ 2>/dev/null
mv DEPLOYMENT.md docs/deployment/ 2>/dev/null
mv TESTING_GUIDE.md docs/deployment/ 2>/dev/null

# 移动开发文档
mv ARCHITECTURE.md docs/development/ 2>/dev/null
mv FIX_SUMMARY.md docs/development/ 2>/dev/null
mv REALITY_CHECK.md docs/development/ 2>/dev/null
mv PROJECT_STRUCTURE.md docs/development/ 2>/dev/null
mv GIT_STRATEGY.md docs/development/ 2>/dev/null
mv BRANCH_STRATEGY_COMPARISON.md docs/development/ 2>/dev/null

# 移动旧文档
mv DOCX_EXPORT_FIX.md docs/legacy/ 2>/dev/null
mv DOCX_TROUBLESHOOTING.md docs/legacy/ 2>/dev/null
mv REFACTORING_PROGRESS.md docs/legacy/ 2>/dev/null
mv UI_REFACTORING_*.md docs/legacy/ 2>/dev/null
mv todos.md docs/legacy/ 2>/dev/null

# 移动脚本
mkdir -p scripts
mv deploy.sh scripts/ 2>/dev/null
mv deploy.ps1 scripts/ 2>/dev/null
mv deploy-smart.sh scripts/ 2>/dev/null
mv setup.sh scripts/ 2>/dev/null

echo "✓ 文档整理完成"
echo ""
echo "新的结构："
echo "docs/"
echo "├── deployment/    (部署文档)"
echo "├── development/   (开发文档)"
echo "└── legacy/        (旧文档)"
echo ""
echo "scripts/           (部署脚本)"
