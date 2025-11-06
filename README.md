# Paper Burner X - AI文献识别、翻译、阅读与智能分析工具

这是一款开源的、在浏览器中即开即用的 AI 工作站，专为扫除海量的 PDF 文献、复杂的公式和跨语言的障碍。

它为需要进行精细、长文本阅读的研究人员和深度学习者设计，致力于将复杂的文档处理、翻译和分析流程整合到单一、流畅的体验中。

<div align="center">
  <img src="https://img.shields.io/badge/版本-2.0.0-blue.svg" alt="版本">
  <img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg" alt="许可证">
  <img src="https://img.shields.io/badge/JavaScript-yellow.svg" alt="JavaScript">
  <img src="https://img.shields.io/badge/Docker-building-2496ED.svg" alt="Docker">
</div>

<div align="center">
  <p><strong> 浏览器即开即用 | 极速并发翻译 | 智能文档分析 </strong></p>
  <p>
    <a href="https://paperburner.viwoplus.site/views/landing/landing-page.html">📱 落地页</a> •
    <a href="#-快速开始">🚀 快速开始</a> •
    <a href="#-特性概览">✨ 特性</a> •
    <a href="deploy/DEPLOYMENT_GUIDE.md">📖 部署文档</a>
  </p>
</div>

---
* 项目分前端版本和后端版本，目前后端版本构建中，请暂时不要拉取docker镜像。

<img width="3303" height="1576" alt="界面预览" src="https://github.com/user-attachments/assets/cb769c1c-33e0-4c12-9174-f2237fb5929b" />


## 🎯 项目简介

**Paper Burner X** 是为研究生和研究人员设计的 AI 驱动文献处理工具。支持 PDF/DOCX/PPTX/EPUB 等多种格式，能够进行 OCR 识别、高质量翻译、智能分析，完美保留公式、图表和格式。

目前实现了：

*   **前端 Agent 驱动的智能检索：** 我们在前端实现了一个 Agentic RAG 系统。通过赋予 AI 全局的文章结构 和一系列工具（如 `grep`, `vector search`, `fetch`等等），AI 能够自主决策、多步推理，并在长文本中实现复杂的分析和信息提取任务。
*   **高性能批量处理：** 支持多种文档格式（PDF/DOCX/EPUB 等）和代码库的直接导入。利用并发 OCR 和翻译，并结合术语库（支持数万词条快速匹配），显著提升了文献处理效率。
*   **高可扩展性与本地化：** 目前所有数据均在浏览器本地，支持用户接入自定义 AI 模型端点，并提供了配套的 [OCR Server](https://github.com/Feather-2/PBX-DS-OCR-server) 和 Docker 部署选项(开发中)，让用户未来可以实现完全离线的本地化使用。

希望这个工具能成为研究人员和知识工作者的得力助手，欢迎试用和提出宝贵意见！

> 该项目扩充了诸多阅读/AI工具上的便利，但如果您需要一个轻量化的文档处理工具，也欢迎使用 [Paper Burner](https://github.com/baoyudu/paper-burner) ， [baoyu](https://github.com/baoyudu) 的原分支。


## 具体介绍

### 一体化的文档处理引擎

我们为工具打造了一个强大的“入口”，使其能够轻松消化各种来源的知识。

*   **广泛的格式支持：** 能够处理 PDF、DOCX、PPTX、EPUB、Markdown 甚至代码注释等多种格式，并支持导出为 DOCX、MD 等常用格式。
*   **智能导入与处理：** 不仅支持本地文件上传，更可一键从 GitHub 仓库或任意 URL 导入内容，自动完成解析。PDF可以使用OCR (支持mineru/doc2x等) 与翻译引擎，并实现**保留原文格式翻译**功能（基于mineru，目前优化中，并会支持更多模型）。
*   **术语备择库：** 进行了性能优化，支持一次性导入数万条术语并进行快速匹配。
*   支持自定义模型端点，可以支持检测、多key、快捷导出等机制，使用灵活。


### 为深度阅读优化的交互体验

*   **沉浸式对照阅读：** 提供智能对齐的段落级原译文对照、文档结构目录（TOC）、高亮与标注功能，先进行无障碍的阅读，再进行AI总结。
*   **增强学术内容展示：** 针对学术场景，特别优化了复杂公式的渲染。
*   **结构化信息提取：** 内置了“文献矩阵”等实用工具，能够将非结构化的论文内容，智能提取为清晰的结构化数据，方便进行横向对比和分析。

### 不止于问答：前端 Agent 驱动的智能分析

- 我们在纯前端环境中，实现了一个长文本Agent。少量文本下，将使用全量的策略；而当提供长文本时候，使用长文本Agent。
-  **赋予 AI 全局视野：** 我们为 AI 构建了“分层意群/地图”，让它在处理长文本时拥有对全文结构的整体认知。
*   **为 AI 配备工具箱：** 我们给予 AI 一系列工具，如精确匹配的 `grep`、向量搜索 `vector search`、内容抓取 `fetch` 等。AI 会根据你的问题，自主分析并决定调用哪种工具组合来寻找最佳答案。

- 上述皆在纯前端实现，浏览器打开即用


### 项目正在活跃地迭代

*   **完全本地化部署：** 正在开发Docker 部署方案，还提供了可自托管的 [OCR Server](https://github.com/Feather-2/PBX-DS-OCR-server)，最终目标是让用户可以完全在离线环境中使用全部功能。
*   **从单文档到多文档：** 下一个里程碑是将能力从分析单篇文献，扩展到处理多篇文献，并基于此开发能自动生成文献综述的 **综述 Agent**，成为真正的 AI 研究助理。

---

**核心优势：**

- ⚡ **极速翻译** - 并发处理，长论文仅需数十秒
- 🎨 **完美排版** - 保留公式、图表、格式
- 🤖 **智能分析** - AI 助手、思维导图、流程图生成
- 🔒 **隐私安全** - 纯前端模式，数据完全本地化
- 🐳 **灵活部署** - 支持 Vercel 静态部署和 Docker 完整部署


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

### 🐳 模式 2：Docker 完整部署

该模式将尽快上线

**使用 Docker Hub 镜像：**

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

- HTML / PDF / DOCX / Markdown（支持图片嵌入或链接）...

---

## 🔑 API 密钥配置

### 纯前端模式

需要在浏览器中配置以下 API 密钥（本地存储）：

1. **OCR 服务**

   - [MinerU](https://github.com/opendatalab/MinerU)
   - [Doc2X](https://doc2x.noedgeai.com/)
   - [Mistral](http://mistral.ai/)

2. **翻译模型**

   - [DeepSeek](https://deepseek.com/)
   - [Google Gemini](https://makersuite.google.com/)
   - [Anthropic Claude](https://www.anthropic.com/)
   - [阿里通义千问](https://www.aliyun.com/)
   - [火山引擎](https://www.volcengine.com/)
   - 自定义模型端点...


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

本项目采用 **GNU Affero General Public License v3.0 (AGPL-3.0)** 许可证开源。

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

本项目基于 [Paper Burner](https://github.com/baoyudu/paper-burner) (GPL-2.0) 的创意开发（该项目是一款pdf极简翻译工具）：

**当前版本 (Paper Burner X)**:

- **许可证**: AGPL-3.0
- **适用范围**: 所有当前代码（大部分为新开发内容），已在原始项目上进行了重构和各方面极多内容的扩充。
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
> 该项目扩充了诸多阅读/AI工具上的便利，但如果您需要一个简洁、轻量化的文档处理工具，也欢迎使用 [Paper Burner](https://github.com/baoyudu/paper-burner) ， [baoyu](https://github.com/baoyudu) 的原分支。

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





