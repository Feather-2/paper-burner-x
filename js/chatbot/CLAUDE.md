# Chatbot 模块

Paper-Burner 的对话交互层，提供 AI 聊天界面和消息处理。

## 模块职责

- **聊天控制器**：管理对话状态和流程
- **消息处理**：发送/接收/渲染消息
- **流式适配**：处理 LLM 流式响应
- **策略模式**：支持多种对话策略

## 子模块

| 子模块 | 路径 | 职责 |
|--------|------|------|
| core | `./core/` | ChatController, MessageHandler, StreamingAdapter |
| config | `./config/` | 聊天配置 |
| ui | `./ui/` | 聊天界面组件 |
| renderers | `./renderers/` | 消息渲染器（Markdown、代码块等） |
| strategy | `./strategy/` | 对话策略（RAG、直接问答等） |
| actions | `./actions/` | 用户操作处理 |
| mcp | `./mcp/` | MCP 协议集成 |

## 公开 API

```javascript
import { createChatbot, ChatController, MessageHandler } from 'js/chatbot';

const chatbot = createChatbot({
  docId,
  historyManager,
  modelRouter,
  retriever,
  eventBus
});
```

## 核心类

### ChatController
管理对话生命周期、历史记录、上下文窗口。

### MessageHandler
处理消息发送、接收、格式化。

### StreamingAdapter
适配不同 LLM 的流式响应格式。

## 与 Agent 集成

- 可作为 Agent 的交互界面
- 通过 EventBus 接收 Agent 事件
- 支持 Tool 调用结果展示

## 开发注意

- 流式响应需要正确处理中断
- 消息渲染器需支持多种格式
- 策略模式便于扩展新对话模式
