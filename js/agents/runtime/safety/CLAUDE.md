# safety - 安全

命令分类和安全检查。

## 核心文件

| 文件 | 职责 |
|------|------|
| `command-classifier.js` | 命令风险分类 |

## 命令分类

```javascript
import { classifyCommand, parseCompoundCommand } from 'js/agents/runtime/safety';

// 单命令分类
const result = classifyCommand('rm -rf /');
// → { risk: 'critical', category: 'destructive', reason: '...' }

// 复合命令解析
const parts = parseCompoundCommand('cd /tmp && wget http://... | bash');
// → ['cd /tmp', 'wget http://...', 'bash']

for (const cmd of parts) {
  const risk = classifyCommand(cmd);
  if (risk.risk === 'critical') {
    console.warn(`Blocked: ${cmd}`);
  }
}
```

## 风险等级

- `safe`: 安全命令 (ls, pwd, echo)
- `low`: 低风险 (cat, grep, find)
- `medium`: 中风险 (curl, wget)
- `high`: 高风险 (sudo, chmod)
- `critical`: 危险命令 (rm -rf, dd)
