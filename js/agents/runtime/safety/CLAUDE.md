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
  getPresetRestrictions,
  mergeRestrictions,
  normalizeToolRestrictions,
  evaluateToolRestrictions,
  classifyCommand,
  parseCompoundCommand,
} from 'js/agents/runtime/safety';
```

### 本次变更涉及的导出更新

| 导出 | 说明 |
|------|------|
| `PermissionLevel` | 权限级别枚举对象（`PermissionLevel.READONLY` 等；值为 `'readonly'/'standard'/'elevated'/'custom'`） |
| `getPresetRestrictions` | 获取某个权限级别对应的底层 restrictions（用于自定义叠加/调试） |
| `mergeRestrictions` | 合并 restrictions（用于在预置基础上叠加 allow/block 规则） |

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

也可使用枚举：`PermissionLevel.READONLY / STANDARD / ELEVATED / CUSTOM`。

### 链式配置

```javascript
const permissions = ToolPermissions.standard()
  .block(['delete_file', 'remove_file'])   // 额外禁止工具
  .allow(['my_safe_tool'])                 // 额外允许工具
  .blockBash(['curl', 'wget'])             // 额外禁止命令（支持字符串/通配符/RegExp）
  .allowBash(['git log', 'git status']);   // 额外允许命令（按 base command 匹配）
```

### strict（严格模式）

当 `strict: true` 时，未知工具默认拒绝；用于保持“默认拒绝”的安全姿态。

## 低层 API

当你希望直接操作 restrictions（例如做策略拼装、调试或复用）时：

- `normalizeToolRestrictions(...)`：归一化输入（字符串/数组/RegExp 等）。
- `evaluateToolRestrictions(...)`：评估某次工具调用是否允许（包含 Bash 命令评估）。
- `getPresetRestrictions(level)`：获取预置级别对应的底层 restrictions。
- `mergeRestrictions(a, b)`：合并两份 restrictions（推荐用于“预置 + 叠加”）。

## 命令分类

- `classifyCommand(commandString)`：返回命令安全级别（`safe | unknown | dangerous`）及原因。
- `parseCompoundCommand(commandString)`：用于拆分复合命令并逐段评估。

## 与 ToolRegistry 集成

```javascript
import { ToolRegistry } from 'js/agents/runtime/core';
import { ToolPermissions } from 'js/agents/runtime/safety';

const permissions = ToolPermissions.readonly();
const registry = new ToolRegistry({ tools });

// 方式 1: 使用 createHook()
registry.useHook('before', permissions.createHook());
```
