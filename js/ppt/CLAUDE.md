# PPT 模块

Paper-Burner 的拳头功能模块，提供 PPT 生成、编辑、渲染的完整能力。

## 模块职责

- **PPT 生成**：从 Agent 输出（大纲/报告）生成 PPT
- **编辑器**：类 PowerPoint 的在线编辑器
- **渲染器**：PPT 预览和导出
- **DSL**：PPT 结构化描述语言

## 子模块索引

| 子模块 | 路径 | 职责 |
|--------|------|------|
| core | `./core/` | PPT 核心数据模型 |
| editor | `./editor/` | 在线编辑器（拖拽、选择、工具栏） |
| generator | `./generator/` | PPT 生成引擎 |
| dashboard | `./dashboard/` | PPT 管理仪表盘 |
| renderers | `./renderers/` | 幻灯片渲染器 |
| dsl | `./dsl/` | PPT DSL 解析器 |
| model-config | `./model-config/` | AI 模型配置 |
| workflow | `./workflow/` | PPT 生成工作流 |
| vision | `./vision/` | 图像分析（用于布局） |
| storage | `./storage/` | PPT 持久化 |

## 公开 API

```javascript
import { Core, Renderers, Generator, Dashboard, ModelConfig } from 'js/ppt';

// 全局变量（Legacy）
window.PPT           // 统一入口
window.PPTGenerator  // 生成器
window.PPTDashboard  // 仪表盘
window.PPTModelConfig // 模型配置
```

## 数据流

```
Agent (DesignAgentLoop)
    ↓ emit PPT_CONTENT_READY
Generator
    ↓ 生成 PPT 结构
Renderers
    ↓ 渲染预览
Editor
    ↓ 用户编辑
Storage
    ↓ 导出 PPTX
```

## 与 Agent 集成

- 订阅 `DesignEvents.PPT_CONTENT_READY`
- 接收大纲/报告结构
- 调用 Generator 生成 PPT

## 开发注意

- 编辑器是核心功能，改动需谨慎
- 渲染器支持多种主题
- DSL 用于结构化 PPT 定义
