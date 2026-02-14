# safety - 安全模块

命令风险分类、工具权限评估与策略编排（Browser-first，Node.js compatible）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `command-classifier.js` | Bash/OS 命令解析、复合命令分段、风险等级判定（`safe/unknown/dangerous`）与敏感路径检测 |
| `tool-restrictions.js` | 底层 restrictions 归一化与评估引擎（工具名 + Bash 命令） |
| `tool-permissions.js` | 高层权限 API（预置级别、链式叠加、统一检查结果） |
| `index.js` | 模块入口导出 |

## 入口导出

```javascript
import {
  ToolPermissions,
  PermissionLevel,
  getPresetRestrictions,
  mergeRestrictions,
  normalizeToolRestrictions,
  evaluateToolRestrictions,
  classifyCommand,
  parseCompoundCommand,
} from 'js/agents/runtime/safety';
```

### 导出说明

| 导出 | 说明 |
|------|------|
| `PermissionLevel` | 权限级别枚举：`READONLY/STANDARD/ELEVATED/CUSTOM` |
| `ToolPermissions` | 高层权限对象，支持预设构造与链式配置 |
| `getPresetRestrictions` | 获取预置权限对应的底层 restrictions |
| `mergeRestrictions` | 合并 restrictions（预设 + 业务自定义） |
| `normalizeToolRestrictions` | restrictions 结构归一化 |
| `evaluateToolRestrictions` | 评估工具/命令是否允许 |
| `classifyCommand` | 单条命令风险分类与审批判定 |
| `parseCompoundCommand` | 复合命令拆分（逐段审计） |

## Command Classifier（`command-classifier.js`）

### 分类结果

`classifyCommand()` 返回：

- `level`: `safe | unknown | dangerous`
- `requiresApproval`: 是否需要审批
- `baseCommand`: 识别出的基础命令
- `reasons`: 触发原因列表（如危险命令、敏感路径等）

### 判定要点

- 内置 `SAFE_COMMANDS` 与 `DANGEROUS_COMMANDS` 基线。
- 支持复合命令解析并逐段检查，避免 `cmd1 && cmd2` 漏检。
- 内置 `DEFAULT_SENSITIVE_PATH_PATTERNS`，覆盖系统账号、SSH、云凭证、容器配置等高风险路径。

## Tool Restrictions（`tool-restrictions.js`）

### 数据结构

```javascript
{
  allowedTools?: (string|RegExp)[],
  blockedTools?: (string|RegExp)[],
  bash?: {
    allowedCommands?: (string|RegExp)[],
    blockedCommands?: (string|RegExp)[],
    toolNames?: string[],
  }
}
```

### 行为规则

- 输入先归一化（字符串列表、数组列表、大小写统一）。
- Bash 命令先拆分复合命令，再按段匹配策略。
- 默认优先级：`blocked > allowed > fallback`。
- `strict` 模式下未知工具/未知命令默认拒绝。

## ToolPermissions API（`tool-permissions.js`）

### 预置级别

| 级别 | 说明 |
|------|------|
| `readonly` | 禁止写入工具；Bash 只允许只读查询类命令 |
| `standard` | 默认阻止高风险命令；未知命令按策略处理 |
| `elevated` | 仅阻止极端危险命令 |
| `custom` | 完全自定义 restrictions 与 strict 行为 |

### 常用方法

- `ToolPermissions.readonly()/standard()/elevated()/custom()`
- `allow()/block()/allowBash()/blockBash()`
- `check(toolName, command?)` 统一返回 `{ allowed, reason, policy }`

## Browser 兼容性

- 使用 ES Modules + JSDoc，无 TypeScript 编译依赖。
- 不依赖 `fs/path/child_process/__dirname/require`，可在浏览器策略层运行。
- OS 命令执行仅为策略判定与审计能力，非浏览器内直接执行。

## 开发与测试建议

- 新增命令规则时同步补充：复合命令、重定向、通配符、敏感路径变体测试。
- 覆盖边界：空输入、超长命令、混合大小写、并发连续检查。
- 建议保持 safety 模块单测覆盖率 ≥ 90%。
