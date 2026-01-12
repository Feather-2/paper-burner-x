# UI 模块

Paper-Burner 的通用 UI 组件和工具集。

## 模块职责

- **通用组件**：Dock、Lightbox、Notifications
- **配置面板**：模型配置、OCR 设置、Embedding 配置
- **管理界面**：Key Manager、Reference Manager、Glossary Editor
- **布局工具**：TOC 逻辑、侧边栏集成、沉浸式布局

## 结构

```
js/ui/
├── components/      # 通用 UI 组件
├── dock/           # 停靠栏组件
├── *-ui.js         # 特定功能 UI
├── ui-*.js         # UI 工具类
└── index.js        # 统一导出
```

## 主要组件

| 组件 | 文件 | 职责 |
|------|------|------|
| 通知系统 | ui-notifications.js | Toast、Alert |
| Key Manager | key-manager-ui.js | API 密钥管理界面 |
| Reference Manager | reference-manager-ui.js | 参考文献管理 |
| Glossary Editor | glossary-editor-enhanced.js | 术语表编辑 |
| TOC | toc_logic*.js | 目录导航和滚动同步 |
| Lightbox | lightbox.js | 图片预览 |
| Model Panels | ui-model-panels.js | 模型选择面板 |

## ESM 双版本

每个组件同时提供 `.js` 和 `.esm.js` 版本：
- `.js`：兼容 script 标签加载
- `.esm.js`：ESM 模块导入

## 与其他模块关系

- **js/ppt**：PPT 编辑器 UI 在 `js/ppt/editor/`
- **js/chatbot**：聊天 UI 在 `js/chatbot/ui/`
- **js/annotations**：标注 UI 在 `js/annotations/`

此模块提供跨功能的通用 UI 组件。

## 开发注意

- 组件需同时维护两个版本（.js / .esm.js）
- 遵循无框架原则（Vanilla JS）
- 响应式设计，支持移动端
