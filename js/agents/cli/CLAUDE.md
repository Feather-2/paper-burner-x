# cli - 命令行工具

开发调试和演示用命令行脚本。

## 文件

| 文件 | 用途 |
|------|------|
| `demo.js` | Agent 演示入口 |
| `model-client.js` | LLM 模型客户端测试 |
| `test-deepsearch.js` | DeepSearch 阶段测试 |
| `test-memory.js` | 记忆系统测试 |
| `config.example.json` | 配置示例 |

## 使用

```bash
# 运行 demo
node js/agents/cli/demo.js

# 测试 DeepSearch
node js/agents/cli/test-deepsearch.js

# 测试记忆系统
node js/agents/cli/test-memory.js
```

## 配置

复制 `config.example.json` 为 `config.json`，并填入模型信息（完整字段见示例文件）：

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

如需角色映射（`tiers`）、Agent/Memory/Report 等高级配置，按 `config.example.json` 扩展。

也可通过环境变量覆盖（优先级更高）：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
