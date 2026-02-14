# deps - 依赖管理

Python Skill 的依赖解析、下载校验、缓存与执行（Pyodide，Browser-first / Node.js compatible）。

该模块负责：
- 解析 Skill `metadata.dependencies`（`builtin` / `micropip` / `wheels`）
- 管理 wheel 下载安全策略（`https` + host allowlist + 文件名清洗 + 可选 `sha256` 校验）
- 生成并执行依赖加载流程
- 通过 `PythonSkillExecutor` 统一执行 Python Skill（支持 `AbortSignal`、输入/输出文件、指标）

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口与导出 |
| `dependency-manager.js` | `DependencyManager`：依赖解析、校验、缓存、加载流程生成 |
| `python-skill-executor.js` | `PythonSkillExecutor`：依赖预加载 + Skill 执行 + 结果封装 |

## 导出

| 导出 | 说明 |
|------|------|
| `DependencyManager` | 解析依赖、生成加载流程、管理缓存 |
| `PythonSkillExecutor` | 执行 Python Skill |
| `createPythonSkillExecutor` | 构建执行器（同步） |
| `executePythonSkill` | 便捷执行单个 Skill |
| `PYODIDE_BUILTIN` | Pyodide 0.26.x 内置包集合（快速分流） |
| `parsePackageName` | 解析包名（去掉版本约束，返回小写） |
| `sha256` | 计算 SHA-256（wheel/缓存校验） |

## 依赖规格（`metadata.dependencies`）

支持三类依赖：

- `builtin`: 由 `pyodide.loadPackage()` 加载的内置包数组
- `micropip`: 由 `micropip.install()` 安装的 PyPI 规格数组（建议固定版本）
- `wheels`: 自定义 wheel 列表（URL + 可选 `sha256`）

```javascript
{
  builtin: ["numpy"],
  micropip: ["tabulate>=0.9,<1"],
  wheels: [
    {
      url: "https://files.pythonhosted.org/packages/.../pkg-1.0.0-py3-none-any.whl",
      sha256: "8f0c..."
    }
  ]
}
```

## 执行流程

1. `DependencyManager` 解析并归类依赖（builtin / micropip / wheels）
2. 对 wheels 执行 URL 与来源校验，并生成缓存文件名
3. 加载依赖到 Python 运行时
4. `PythonSkillExecutor` 注入上下文、执行 Skill、封装结果与指标

## 安全与限制

- Wheels URL：仅允许 `https:`，并限制 allowlist 域名（默认 `files.pythonhosted.org`、`pypi.org`）
- 完整性：建议每个 wheel 提供 `sha256`，下载后强校验
- 文件名安全：wheel 缓存文件名需清洗非法字符、限制长度，并拒绝特殊保留名（如 `.` / `..`）
- 不信任 Skill：需运行时隔离（Worker / iframe / 进程）并限制 Pyodide ↔ JS 桥接能力
- 错误处理：依赖加载与执行异常需记录并转换为用户友好错误

## 浏览器兼容性说明

`python-skill-executor.js` 当前仍包含 `node:path` 依赖。纯浏览器直接运行时，需使用条件导入、构建别名或无 Node 内置模块实现。

## 使用示例

```javascript
import { executePythonSkill } from "js/agents/plugins/deps";

const result = await executePythonSkill({
  skill: {
    metadata: {
      name: "stats",
      runtime: "python",
      dependencies: {
        builtin: ["numpy"],
        micropip: ["tabulate==0.9.0"]
      }
    },
    code: "def run(ctx):\\n    return {'ok': True}"
  },
  context: {
    state: { input: [1, 2, 3] },
    vfs
  }
});
```
