# tools (deepsearch) - DeepSearch 工具

DeepSearch 阶段的工具处理器。

## 工具列表

| 工具 | 目录 | 用途 |
|------|------|------|
| advise-task | `advise-task/` | 向用户建议下一步任务 |
| ask-user | `ask-user/` | 向用户提问获取澄清 |
| get-task-result | `get-task-result/` | 获取子任务执行结果 |
| list-docs | `list-docs/` | 列出可用文档源 |
| read-doc | `read-doc/` | 读取文档内容 |
| refine-planning | `refine-planning/` | 细化任务规划 |
| watchdog | `watchdog/` | 资源监控告警 |

## 工具结构

每个工具目录包含：
- `handler.js` - 工具执行器
- `schema.js` (可选) - 参数 Schema
- `prompt.md` (可选) - 工具提示词

## 使用示例

```javascript
import { tools, executeTool, getToolCatalogPrompt } from 'js/agents/stages/deepsearch/tools';

// 获取工具目录提示词
const catalog = getToolCatalogPrompt();

// 执行工具
const result = await executeTool('read-doc', {
  docId: 'doc-123',
  section: 'introduction',
}, context);
```
