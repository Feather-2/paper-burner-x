# cli - 命令行工具

开发调试和演示用命令行脚本（Node.js 环境）。

> 注意：该目录包含 Node-only 模块（如 `model-client.js`），不要在浏览器端 import。

## 文件

| 文件 | 用途 |
|------|------|
| `demo.js` | Agent CLI Demo（可选模型对话、列出技能/子代理、dry-run） |
| `model-client.js` | CLI 模型路由与 AI API 适配器（读取 `config.json` + 环境变量覆盖） |
| `test-deepsearch.js` | DeepSearch 交互测试（可传入 md 文件路径；默认 `docs/agents`） |
| `test-memory.js` | 记忆系统测试 |
| `config.example.json` | 配置示例（复制为 `config.json`） |

## 使用

```bash
# 帮助
node js/agents/cli/demo.js --help

# 仅构建 Agent，不执行
node js/agents/cli/demo.js --dry-run

# 模型对话（需要 OPENAI_API_KEY）
OPENAI_API_KEY=sk-xxx node js/agents/cli/demo.js --chat "你好"

# 列出所有可用技能 / 子代理类型
node js/agents/cli/demo.js --list-skills
node js/agents/cli/demo.js --list-subagents

# DeepSearch（交互模式）
node js/agents/cli/test-deepsearch.js
node js/agents/cli/test-deepsearch.js docs/agents/*.md
```

## 配置

复制 `config.example.json` 为 `config.json`，并填入模型信息（完整字段见示例文件）。

配置优先级：环境变量 > `config.json` > 默认值。

也可通过环境变量覆盖：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`（默认 `https://api.deepseek.com/v1`）
- `OPENAI_MODEL`（默认 `deepseek-chat`）

最小配置示例：

```json
{
  "models": {
    "normal": {
      "baseUrl": "https://api.deepseek.com/v1",
      "model": "deepseek-chat",
      "apiKey": "sk-..."
    }
  },
  "default": "normal"
}
```

如需角色映射（`tiers` / `roles`）、Agent/Memory/Report 等高级配置，按 `config.example.json` 扩展。
