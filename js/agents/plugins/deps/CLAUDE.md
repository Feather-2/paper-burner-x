# deps - 依赖管理

Python Skill 的依赖解析、缓存与执行（Pyodide）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口与导出 |
| `dependency-manager.js` | DependencyManager - 解析/缓存 Pyodide 依赖 |
| `python-skill-executor.js` | PythonSkillExecutor - 执行 Python Skill |

## 导出

| 导出 | 说明 |
|------|------|
| `DependencyManager` | 解析依赖、生成加载脚本、管理缓存 |
| `PythonSkillExecutor` | 执行 Python Skill |
| `createPythonSkillExecutor` | 构建执行器（同步） |
| `executePythonSkill` | 便捷执行单个 Skill |
| `PYODIDE_BUILTIN` | Pyodide 内置包集合 |
| `parsePackageName` | 解析包名 |
| `sha256` | 计算 SHA-256 |

## Python Skill 执行

基于 Pyodide 执行 Python Skill：

```javascript
import { executePythonSkill } from 'js/agents/plugins/deps';

const skill = {
  metadata: {
    name: "stats",
    runtime: "python",
    dependencies: {
      builtin: ["pandas"],
      micropip: ["tabulate>=0.9"],
      wheels: [{ url: "https://example.com/pkg.whl", sha256: "..." }],
    },
    entrypoint: "main.py",
  },
  path: "/skills/stats",
};

const result = await executePythonSkill(skill, {
  state: { data: inputData },
  vfs,
});
```

## DependencyManager

```javascript
import { DependencyManager } from 'js/agents/plugins/deps';

const manager = new DependencyManager({ vfs });

const plan = await manager.resolve({
  builtin: ["numpy"],
  micropip: ["pyyaml>=6.0"],
});

const loadScript = manager.generateLoadScript(plan);
```
