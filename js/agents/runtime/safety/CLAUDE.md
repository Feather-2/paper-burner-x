# safety - 安全模块

命令风险分类、工具权限和安全检查（Browser-first，Node.js compatible）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `command-classifier.js` | Bash/OS 命令解析与风险分类（支持复合命令与敏感路径检测） |
| `tool-restrictions.js` | 工具限制评估（工具名 + Bash 命令），底层策略与归一化 |
| `tool-permissions.js` | 工具权限 API（高层封装），预置级别 + 链式配置 |
| `index.js` | 入口导出 |

## 入口导出

```javascript
import {
  ToolPermissions,
  PermissionLevel,
  normalizeToolRestrictions,
  evaluateToolRestrictions,
  classifyCommand,
  parseCompoundCommand,
} from 'js/agents/runtime/safety';
```

## ToolPermissions API

高层级工具权限管理，支持预定义级别和自定义配置。

### 快速使用

```javascript
import { ToolPermissions } from 'js/agents/runtime/safety';

// 预定义级别
const readonly = ToolPermissions.readonly();
const standard = ToolPermissions.standard();
const elevated = ToolPermissions.elevated();

// 检查工具权限
readonly.check('write', null);
// → { allowed: false, reason: 'tool_blocked', policy: {...} }

// 检查 Bash 命令（会解析复合命令并逐段评估）
standard.check('bash', 'rm -rf /');
// → { allowed: false, reason: 'command_blocked', policy: {...} }
```

### 权限级别

| 级别 | 说明 |
|------|------|
| `readonly` | 只读模式，禁止写入工具；Bash 仅允许只读/查询类命令 |
| `standard` | 标准模式，默认阻止危险 Bash 命令（未知命令可按策略要求审批） |
| `elevated` | 提升模式，仅阻止极端危险命令 |
| `custom` | 自定义模式，无预设限制（由 restrictions/strict 决定） |

### 链式配置

```javascript
const permissions = ToolPermissions.standard()
  .block(['delete_file', 'remove_file'])   // 额外禁止工具
  .allow(['my_safe_tool'])                 // 额外允许工具
  .blockBash(['curl', 'wget'])             // 额外禁止命令（支持字符串/通配符/RegExp）
  .allowBash(['git log', 'git status']);   // 额外允许命令（按 base command 匹配）
```

### 与 ToolRegistry 集成

```javascript
import { ToolRegistry } from 'js/agents/runtime/core';
import { ToolPermissions } from 'js/agents/runtime/safety';

const permissions = ToolPermissions.readonly();
const registry = new ToolRegistry({ tools });

// 方式 1: 使用 createHook()
registry.useHook('before', permissions.createHook());

// 方式 2: 通过 context 传递（由 createPreToolUseHook 自动使用）
await registry.callTool('write', params, {
  toolRestrictions: permissions.getRestrictions(),
  permissionLevel: permissions.getLevel(),
});
```

### 严格模式

严格模式下：未明确允许的工具默认拒绝（更适合“默认拒绝”的运行环境）。

```javascript
import { ToolPermissions } from 'js/agents/runtime/safety';

const strict = new ToolPermissions({
  level: 'custom',
  strict: true,
  restrictions: {
    allowedTools: ['read', 'glob', 'grep'],
    // 也可同时配置 bash.allowedCommands / bash.blockedCommands
  },
});
```

## ToolRestrictions 结构

底层限制对象由 `normalizeToolRestrictions()` 归一化，并由 `evaluateToolRestrictions()` 执行评估。

```javascript
/**
 * @typedef {object} ToolRestrictions
 * @property {(RegExp|string)[]} [allowedTools]
 * @property {(RegExp|string)[]} [blockedTools]
 * @property {object} [bash]
 * @property {(RegExp|string)[]} [bash.allowedCommands]
 * @property {(RegExp|string)[]} [bash.blockedCommands]
 */
```

## Command Classifier（Bash 命令分类）

`classifyCommand()` 用于对单条命令进行风险分类；`parseCompoundCommand()` 用于拆分复合命令（如 `&&` / `;` / `|` 等），供策略逐段评估。

- 输出级别：`safe | unknown | dangerous`
- 关键字段：`requiresApproval`（是否需要审批）、`baseCommand`（归一化后的命令名/子命令）
- 内置敏感路径规则：对读取/访问常见凭证与系统敏感文件的命令进行升级处理（避免泄露密钥/凭证）

## 设计边界

- 本模块只做“策略判定”，不负责执行命令或调用工具。
- Browser-first：避免依赖 `fs/path/child_process` 等 Node-only API；需要执行时由上层运行时决定。

## 测试建议（高优先）

- 复合命令拆分：引号、转义、嵌套子命令、重定向、管道与多分隔符组合。
- 只读模式绕过：`find -delete`、`find -exec ...`、`echo hi > file`、`cat file | sh` 等。
- 敏感路径命中：`/etc/passwd`、`~/.ssh/*`、云凭证文件等（含大小写与相对路径变体）。
