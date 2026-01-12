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

复制 `config.example.json` 为 `config.json`，填入 API 密钥：

```json
{
  "openai": { "apiKey": "sk-..." },
  "anthropic": { "apiKey": "sk-ant-..." }
}
```
