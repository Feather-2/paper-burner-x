# deps - 依赖管理

Python Skill 执行和依赖管理。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口 |
| `dependency-manager.js` | DependencyManager - 依赖管理 |
| `python-skill-executor.js` | PythonSkillExecutor |

## Python 支持

基于 Pyodide (Python WASM) 运行 Python Skill：

```javascript
import { PythonSkillExecutor, PYODIDE_BUILTIN } from 'js/agents/runtime/deps';

const executor = await createPythonSkillExecutor();

const result = await executor.execute(`
import pandas as pd
df = pd.DataFrame(data)
return df.describe().to_dict()
`, { data: inputData });
```

## DependencyManager

```javascript
import { DependencyManager } from 'js/agents/runtime/deps';

const manager = new DependencyManager();
await manager.install(['numpy', 'pandas']);
await manager.ensure('scikit-learn');
```
