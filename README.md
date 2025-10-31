# Paper Burner X - AI文献识别、翻译、阅读与智能分析工具

<div align="center">
  <img src="https://img.shields.io/badge/版本-2.0.0-blue.svg" alt="版本">
  <img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg" alt="许可证">
  <img src="https://img.shields.io/badge/JavaScript-yellow.svg" alt="JavaScript">
  <img src="https://img.shields.io/badge/Docker-building-2496ED.svg" alt="Docker">
</div>

<div align="center">
  <p><strong>浏览器即开即用 | 极速并发翻译 | 智能文档分析 | Docker 一键部署</strong></p>
  <p>
    <a href="https://paperburner.viwoplus.site/views/landing/landing-page.html">📱 落地页</a> •
    <a href="#-快速开始">🚀 快速开始</a> •
    <a href="#-特性概览">✨ 特性</a> •
    <a href="deploy/DEPLOYMENT_GUIDE.md">📖 部署文档</a>
  </p>
</div>

---
* 项目分前端版本和后端版本，目前后端版本构建中，请暂时不要拉取docker镜像。

## 🎯 项目简介

**Paper Burner X** 是为研究生和研究人员设计的 AI 驱动文献处理工具。支持 PDF/DOCX/PPTX/EPUB 等多种格式，能够进行 OCR 识别、高质量翻译、智能分析，完美保留公式、图表和格式。

**核心优势：**

- ⚡ **极速翻译** - 并发处理，长论文仅需数十秒
- 🎨 **完美排版** - 保留公式、图表、格式
- 🤖 **智能分析** - AI 助手、思维导图、流程图生成
- 🔒 **隐私安全** - 纯前端模式，数据完全本地化
- 🐳 **灵活部署** - 支持 Vercel 静态部署和 Docker 完整部署

<img width="3303" height="1576" alt="界面预览" src="https://github.com/user-attachments/assets/cb769c1c-33e0-4c12-9174-f2237fb5929b" />

---

## 🚀 快速开始

Paper Burner X 提供**两种部署模式**，根据你的需求选择：

### 📱 模式 1：纯前端部署（推荐个人使用）

**特点：**

- ✅ 无需服务器，完全免费
- ✅ 5 分钟快速部署到 Vercel
- ✅ 数据存储在浏览器本地，隐私安全
- ✅ 适合个人使用和快速体验

**部署步骤：**

```bash
# 1. Fork 本仓库到你的 GitHub 账号

# 2. 在 Vercel 中导入项目
# 访问 https://vercel.com/new
# 选择你 fork 的仓库
# 点击 Deploy

# 3. 部署完成！访问你的域名即可使用
```

> 💡 **提示：** 纯前端模式下，所有数据存储在浏览器 localStorage/IndexedDB 中，不会上传到任何服务器。

**在线体验：** [https://paperburner.viwoplus.site](https://paperburner.viwoplus.site)

---

### 🐳 模式 2：Docker 完整部署（推荐团队使用）

**特点：**

- ✅ 包含后端服务器 + PostgreSQL 数据库
- ✅ 支持多用户、用户认证、权限管理
- ✅ 管理员面板，可管理用户和系统配置
- ✅ 数据持久化存储
- ✅ 适合团队协作和生产环境

**快速部署：**

```bash
# 1. 克隆仓库
git clone https://github.com/Feather-2/paper-burner-x.git
cd paper-burner-x

# 2. 配置环境变量
cp .env.example .env
nano .env  # 修改数据库密码、JWT 密钥、管理员账号等

# 3. 启动服务
docker-compose up -d

# 4. 访问服务
# 前端: http://localhost:3000
# 管理面板: http://localhost:3000/admin
```

**或使用 Docker Hub 镜像：**

```bash
docker pull feather2dev/paper-burner-x:latest
```

> 📖 **详细文档：** [完整部署指南](deploy/DEPLOYMENT_GUIDE.md)

---

## ✨ 特性概览

### 1. ⚡ 极速并发翻译

- **多文件并发处理** - 一次上传多个文件，自动排队处理
- **高速并发翻译** - 理想情况下，长论文翻译仅需几十秒
- **自定义并发数** - 可配置文件处理和翻译任务的并发数量
- **提示词池机制** - 智能健康管理提示词，保证翻译质量
- **文件夹批量导入** - 支持整个库/文件夹翻译，保留文件夹层级

### 2. 🔧 灵活的配置管理

- **术语库系统** - 维护多套术语库，自动注入翻译提示，保持术语一致性
- **自定义提示词** - 支持自定义翻译 Prompt，满足客制化需求
- **提示词池生成** - AI 自动生成提示词变体，保证核心需求不变
- **模型自动检测** - 通过 `/v1/models` API 自动检测可用模型
- **多 Key 轮询** - 支持多个 API Key 轮询使用，提高稳定性
- **配置导入导出** - 方便迁移和备份配置

### 3. 📖 增强的阅读体验

- **历史记录面板** - 基于 IndexedDB 存储，支持原文/译文/对比模式
- **公式与表格渲染** - 完美支持 LaTeX 公式、图片、表格渲染
- **分块对比** - 原文与译文智能对齐，段落级精准对比
- **目录导航 (TOC)** - 快速浏览文档结构，实现内容间快速跳转
- **沉浸式阅读** - 桌面端沉浸模式，所有要素集中在一个画面
- **标注与高亮** - 字级高亮和标注，支持多种颜色

### 4. 🤖 智能文档分析

- **AI 聊天助手** - 对长文档进行提问和分析，支持流式输出
- **快捷指令** - 预置学术相关问题，快速提问
- **思维导图生成** - 自动生成文档思维导图
- **流程图生成** - 支持 Mermaid 流程图生成和编辑
- **对话导出** - 将 AI 对话内容快速导出为图片
- **图片上传** - 支持上传图片进行多模态对话

### 5. 📁 多格式支持

**支持导入：**

- PDF / Markdown / TXT / DOCX / PPTX / HTML / EPUB

**支持导出：**

- HTML / PDF / DOCX / Markdown（支持图片嵌入或链接）

---

## 🔑 API 密钥配置

### 纯前端模式

需要在浏览器中配置以下 API 密钥（本地存储，不会上传）：

1. **OCR 服务**（二选一）

   - [MinerU](https://github.com/opendatalab/MinerU) - 开源 OCR
   - [Doc2X](https://doc2x.noedgeai.com/) - 商业 OCR
2. **翻译模型**（可选多个）

   - [DeepSeek](https://deepseek.com/)
   - [Google Gemini](https://makersuite.google.com/)
   - [Anthropic Claude](https://www.anthropic.com/)
   - [阿里通义千问](https://www.aliyun.com/)
   - [火山引擎](https://www.volcengine.com/)

### Docker 模式

在 `.env` 文件中配置，也可以通过管理面板配置：

```bash
# OCR 服务
MINERU_API_TOKEN=your_token
DOC2X_API_TOKEN=your_token

# 翻译模型
DEEPSEEK_API_KEY=your_key
GEMINI_API_KEY=your_key
CLAUDE_API_KEY=your_key
# ...更多配置见 .env.example
```

---

## 🎮 使用指南

### 基本使用流程

1. **上传文档** - 支持拖拽或点击上传
2. **OCR 识别** - 自动提取文本和图片
3. **配置翻译** - 选择目标语言和翻译模型
4. **开始翻译** - 自动分块处理，并发翻译
5. **查看结果** - 原文/译文/对比模式查看
6. **导出文档** - 选择格式导出（HTML/PDF/DOCX/MD）

### 高级功能

- **术语库管理** - 在设置中添加专业术语，提高翻译准确性
- **批量处理** - 上传整个文件夹，批量翻译
- **AI 分析** - 使用聊天助手深入分析文档内容
- **思维导图** - 自动生成文档结构思维导图

---

## 📊 性能对比

| 模式             | 部署时间 | 适用场景 | 数据存储   | 性能       |
| ---------------- | -------- | -------- | ---------- | ---------- |
| 纯前端（Vercel） | 5 分钟   | 个人使用 | 浏览器本地 | ⭐⭐⭐⭐⭐ |
| Docker 完整版    | 15 分钟  | 团队协作 | PostgreSQL | ⭐⭐⭐⭐   |

---

## 🗺️ 路线图

- [X] 纯前端模式
- [X] Docker 部署支持
- [X] 多用户系统
- [X] 管理员面板
- [X] 更多 OCR 引擎支持
- [X] 移动端适配优化
- [ ] UI 界面重构
- [ ] 云端同步（可选）

---

## 🤝 贡献指南

欢迎为 Paper Burner X 做出贡献！

**参与方式：**

- 🐛 [报告 Bug](https://github.com/Feather-2/paper-burner-x/issues)
- 💡 [提出新功能建议](https://github.com/Feather-2/paper-burner-x/issues)
- 🔧 [提交 Pull Request](https://github.com/Feather-2/paper-burner-x/pulls)
- 📖 [改进文档](https://github.com/Feather-2/paper-burner-x/wiki)
- ⭐ [为项目点 Star](https://github.com/Feather-2/paper-burner-x)

---

## 📚 相关文档

- [部署指南](deploy/DEPLOYMENT_GUIDE.md) - 详细的部署步骤
- [本地测试指南](deploy/LOCAL_TESTING.md) - 本地开发和测试

---

## ⚠️ 注意事项

- AI 模型翻译结果仅供参考，重要内容请以原文为准
- 大型文档的处理可能需要较长时间，请耐心等待
- 对于包含特殊格式的 PDF，OCR 结果可能需要人工校对
- 使用 API 时请遵守相应服务提供商的使用条款
- 纯前端模式下，数据存储在浏览器本地，清除浏览器数据会丢失历史记录

---

## 📄 许可证

本项目采用 **GNU Affero General Public License v3.0 (AGPL-3.0)** 许可证。

### 📋 关键要求

如果你部署本项目作为网络服务（包括但不限于）：

- 公开的 Web 服务
- SaaS 平台
- 内部企业服务

**你必须**：

1. 在用户界面显著位置提供"源代码"链接
2. 用户可以通过该链接免费获取完整源代码
3. 包括你所做的任何修改

### 📜 许可证说明

本项目基于 [Paper Burner](https://github.com/baoyudu/paper-burner) (GPL-2.0) 的创意开发：

**当前版本 (Paper Burner X)**:

- **许可证**: AGPL-3.0
- **适用范围**: 所有当前代码（大部分为新开发内容）
- **作者**: Feather-2 and contributors
- **版权**: Copyright (C) 2024-2025 Feather-2 and contributors

**历史归属 (Original Paper Burner)**:

- **许可证**: GPL-2.0
- **适用范围**: 重构前，与mistral翻译相关的原始代码和部分ui（见 git 历史记录 before May 16, 2025）
- **作者**: Baoyu (baoyudu)
- **仓库**: https://github.com/baoyudu/paper-burner

**为什么使用 AGPL-3.0？**

作为我所写这部分代码的版权持有人，我选择 AGPL-3.0 是为了：

- ✅ 防止"云服务漏洞"（部署为 SaaS 必须开源）
- ✅ 保护开源社区的利益（修改必须回馈）

详见 [NOTICE](NOTICE) 文件和 [LICENSE](LICENSE) 文件。

---

## 🙏 致谢

> 本项目是在 [Paper Burner](https://github.com/baoyudu/paper-burner) 原项目基础上进行扩充和修改的，为示尊重和区分，故命名为 Paper Burner X。

**贡献者：**

<div align="center">
  <a href="https://github.com/feather-2/paper-burner-x/graphs/contributors">
    <img src="https://contrib.rocks/image?repo=feather-2/paper-burner-x" />
  </a>
</div>

---

<div align="center">
  <p><strong>如果这个工具对您有帮助，请考虑给项目一个 ⭐</strong></p>
  <p>
    <a href="https://github.com/Feather-2/paper-burner-x">GitHub</a> •
    <a href="https://paperburner.viwoplus.site">在线体验</a>
  </p>
</div>




