# deps - 依赖管理

Python Skill 的依赖解析、缓存与执行（Pyodide，Browser-first / Node.js compatible）。

该模块负责：
- 解析 Skill `metadata.dependencies`（builtin/micropip/wheels）
- 生成并执行 Pyodide 依赖加载脚本（含基础安全校验：`https:` + host allowlist、wheel 文件名清洗、可选哈希校验）
- 通过 `PythonSkillExecutor` 统一执行 Python Skill（支持 AbortSignal、输入/输出文件、指标）

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口与导出 |
| `dependency-manager.js` | `DependencyManager` - 解析/缓存 Pyodide 依赖（builtin/micropip/wheels） |
| `python-skill-executor.js` | `PythonSkillExecutor` - 执行 Python Skill（依赖预加载 + 运行 + 结果封装） |

## 导出

| 导出 | 说明 |
|------|------|
| `DependencyManager` | 解析依赖、生成加载脚本、管理缓存 |
| `PythonSkillExecutor` | 执行 Python Skill |
| `createPythonSkillExecutor` | 构建执行器（同步） |
| `executePythonSkill` | 便捷执行单个 Skill |
| `PYODIDE_BUILTIN` | Pyodide 0.26.x 内置包集合（用于快速判断/分流） |
| `parsePackageName` | 解析包名（去掉版本约束，返回小写） |
| `sha256` | 计算 SHA-256（用于 wheel/缓存校验） |

## 依赖规格（Skill metadata.dependencies）

支持三类依赖：

- `builtin`: 由 `pyodide.loadPackage()` 加载的内置包名数组
- `micropip`: 交给 `micropip.install()` 的 PyPI 规格数组（建议固定版本）
- `wheels`: 自定义 wheel 列表（URL + 可选 sha256，用于下载后校验与缓存）

```javascript
{
  builtin: ['numpy'],
  micropip: ['tabulate>=0.9'],
  wheels: [{ url: 'https://files.pythonhosted.org/.../pkg.whl', sha256: '...' }],
}
```

## 安全与限制

- Wheels URL：仅允许 `https:`，并对 host 做 allowlist 校验（默认：`files.pythonhosted.org`、`pypi.org`，见内部 `WHEEL_HOST_ALLOWLIST`）；不要接受用户任意 URL。
- 重定向：下载 wheel 时需防止重定向到 allowlist 外的域名。
- 完整性：建议对 wheel 强制提供 `sha256` 并在下载后验证，避免供应链污染。
- 缓存：wheel 文件名从 URL 派生并清洗（去掉 query/hash，替换非法字符，长度上限 200）；仍需防止 `.`/`..` 等特殊文件名导致路径穿越，并限制下载大小/数量。
- 不信任 Skill：若 Skill 代码来源不可信，需要在运行时隔离（Worker/iframe/进程级隔离），避免通过 Pyodide ↔ JS 桥接访问宿主敏感能力。
- 浏览器兼容性：`python-skill-executor.js` 目前依赖 `node:path`；如需在浏览器直接运行，应改为不依赖 Node 内置模块的实现或通过构建别名/条件导入处理。

## Python Skill 执行

基于 Pyodide 执行 Python Skill：

```javascript
import { executePythonSkill } from 'js/agents/plugins/deps';

const skill = {
  metadata: {
    name: 'stats',
    runtime: 'python',
    dependencies: {
      builtin: ['pandas'],
      micropip: ['tabulate>=0.9'],
      wheels: [{ url: 'https://files.pythonhosted.org/.../pkg.whl', sha256: '...' }],
    },
    entrypoint: 'main.py',
  },
  path: '/skills/stats',
};

const abort = new AbortController();

// options 的具体字段以 PythonSkillExecutor/executePythonSkill 实现为准
const result = await executePythonSkill(skill, {
  signal: abort.signal,
  state: {},
});

if (!result.success) {
  throw new Error(result.error || 'Python skill failed');
}
```
