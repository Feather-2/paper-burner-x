
# Paper Burner - AI文献识别、翻译、阅读与智能分析工具

<div align="center">
  <img src="https://img.shields.io/badge/版本-1.0.0-blue.svg" alt="版本">
  <img src="https://img.shields.io/badge/License-GPL_v2-blue.svg" alt="许可证">
  <img src="https://img.shields.io/badge/Pure-JavaScript-yellow.svg" alt="JavaScript">
</div>

[点击以查看分支特性](https://paperburner.viwoplus.site/views/landing/landing-page.html)

## ✨ 分支新特性概览 (截至25/5/29)

本次分支在翻译过程、模型支持、用户体验、智能辅助等方面进行了部分修改。主要特性包括：

1.  **对翻译进行加速:**
    *   **多文件与高速并发翻译:** 支持上传多个文件，实现快速（如长论文在短时间20s内完成）并发翻译。
    *   **自定义并发数:** 用户可自定义文件处理/翻译任务的并发数量。

2.  **灵活的模型与提示词配置:**
    *   **自定义翻译提示词:** 支持自定义翻译的Prompt，以满足客制化需求。
    *   **自定义模型设置:** 改用Base URL方式配置模型，并通过（v1/models）API自动检测可用模型。
    *   **AI助手模型选择:** 为智能聊天助手新增模型选择功能，用户可从自动获取的列表中选择。
    *   **优化AI提示词:** 改进默认AI提示词，特别是优化了公式输出格式，确保更好地渲染显示。

3.  **增强的阅读与交互体验:**
    *   **历史记录面板:** 基于IndexDB存储历史转换记录，支持原文译文/对比等多种模式查看OCR与翻译结果。
    *   **基础渲染支持:** 历史记录和查看模式下支持基础的公式、图片和表格渲染。
    *   **分块对比:** 新增原文与译文的分块对比功能，显著提升文本对照的直观性和校对效率。
    *   **目录 (TOC):** 引入目录功能，方便用户快速浏览文档结构并实现内容间的快速跳转。
    *   **UI优化:** 对部分用户界面元素和布局进行了改进，提升整体视觉效果和用户体验。

4.  **智能文档分析与辅助:**
    *   **智能聊天助手:** 能够通过AI模型对长文档内容进行提问和分析，并支持内容导出。
    *   **思维导图生成:** 能够按需生成与导出文档大意内容的思维导图。
    *   **流式输出:** AI助手能够实现流式输出

5.  **源站和Key的管理:**
    *   **多源站和多Key轮询的支持:** 能够保存多个不同源站的不同配置，支持翻译时多Key轮询和配置的导入导出。
    *   **新增密钥管理页面** 能够更自如的切换、获取可用模型列表、查看和测活等常见的管理Key的操作。

## 📚 该分支支持的翻译大模型

  - DeepSeek v3
  - Gemini 部分模型
  - 阿里云百炼Deepseek-v3
  - 阿里云 Qwen
  - 火山引擎Deepseek-v3
  - 火山引擎豆包
  - Mistral Large
  - 基于openai格式的自定义模型


---


## 📝 项目介绍

Paper Burner是为广大研究生和研究人员设计的PDF文档处理工具。考虑到对于非母语者，直接阅读英文PDF文献不方便、效率低，而目前的全文翻译工具无法很好地处理PDF中的公式和图表，且存在段落之间断开、语意不连贯的问题，Paper Burner能够从PDF文档中提取文本（OCR），将其转换为Markdown格式，并支持使用多种AI模型进行高质量翻译，完美保留公式、图表、格式，最大限度地保持语意连贯通顺。

本工具完全在浏览器中运行。

## ✨ 核心特性

- **PDF文本提取**：使用Mistral AI的OCR技术从PDF文档中精确提取文本内容
- **Markdown转换**：自动将提取的内容转换为规范的Markdown格式
- **图像处理**：自动提取并保存PDF中的图片
- **多模型翻译**：支持多种顶级AI大模型进行翻译
- **长文档翻译**：自动按照文章小节分段处理长文档，避免段落中出现断点，确保翻译质量和内容一致性
- **保留格式**：翻译过程中完美保留原文档的格式、公式和结构 


## 🚀 快速开始

### 在线使用

本工具可以直接通过浏览器使用，无需安装：

1. 访问[在线版Paper Burner](https://baoyu.space/paper-burner/)
2. 输入必要的API密钥
3. 上传PDF文档
4. 选择所需的翻译模型和目标语言
5. 点击处理按钮
6. 等待处理完成，下载压缩包**并解压**
7. 使用你喜欢的Markdown阅读器打开Markdown文件


## 🔑 API密钥配置

本工具需要以下API密钥才能正常工作：

1. **Mistral API Key**（必需）：用于PDF文档的OCR处理
   - 获取方式：[Mistral AI官网](https://mistral.ai/)

2. **翻译API Key**（可选）：根据选择的翻译模型而定
   - DeepSeek: [DeepSeek AI官网](https://deepseek.com/)
   - Gemini: [Google AI Studio](https://makersuite.google.com/)
   - Claude: [Anthropic官网](https://www.anthropic.com/)
   - 通义百炼: [阿里云官网](https://www.aliyun.com/)
   - 火山引擎: [火山引擎官网](https://www.volcengine.com/)

所有API密钥均在本地浏览器中处理，不会上传到任何服务器，确保安全性。您可以选择通过浏览器本地存储功能保存密钥，方便下次使用。


## ⚠️ 注意事项

- AI模型翻译结果仅供参考，重要内容请以原文为准，本工具不对翻译内容的准确性、完整性和合法性负责
- 大型文档的处理可能需要较长时间，请耐心等待
- 对于包含特殊格式的PDF，OCR结果可能需要人工校对
- 使用API时请遵守相应服务提供商的使用条款

## 🤝 贡献指南

欢迎为Paper Burner做出贡献！您可以通过以下方式参与：

1. 提交Issue：报告Bug或提出新功能建议
2. 提交Pull Request：改进代码或添加新功能
3. 改进文档：完善使用说明或提供使用示例
4. 为项目点一个Star⭐：

## 📄 许可证

本项目采用GPL-v2许可证 - 详见 [LICENSE](LICENSE) 文件


<div align="center">
  <p>如果这个工具对您有帮助，请考虑给项目一个⭐</p>
  <p>Contributors</p>
  <a href="https://github.com/baoyudu/paper-burner/graphs/contributors">
    <img src="https://contrib.rocks/image?repo=baoyudu/paper-burner" />
  </a>
</div>
