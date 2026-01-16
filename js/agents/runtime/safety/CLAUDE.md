# safety - 安全模块

命令分类、工具权限和安全检查。

## 核心文件

| 文件 | 职责 |
|------|------|
| `command-classifier.js` | 命令风险分类 |
| `tool-restrictions.js` | 工具限制评估 (底层) |
| `tool-permissions.js` | 工具权限 API (高层封装) |
| `index.js` | 入口导出 |

## ToolPermissions API

高层级工具权限管理，支持预定义级别和自定义配置。

### 快速使用

```javascript
import { ToolPermissions } from 'js/agents/runtime/safety';

// 预定义级别
const readonly = ToolPermissions.readonly();
const standard = ToolPermissions.standard();
const elevated = ToolPermissions.elevated();

// 检查权限
const result = readonly.check('write', null);
// → { allowed: false, reason: 'tool_blocked', policy: {...} }

const bashResult = standard.check('bash', 'rm -rf /');
// → { allowed: false, reason: 'command_blocked', policy: {...} }
```

### 权限级别

| 级别 | 说明 |
|------|------|
| `readonly` | 只读模式，禁止写入工具，Bash 仅允许查看命令 |
| `standard` | 标准模式，禁止危险 Bash 命令 |
| `elevated` | 提升模式，仅禁止极端危险命令 |
| `custom` | 自定义模式，无预设限制 |

### 链式配置

```javascript
const permissions = ToolPermissions.standard()
  .block(['delete_file', 'remove_file'])  // 额外禁止工具
  .allow(['my_safe_tool'])                 // 额外允许工具
  .blockBash(['curl', 'wget'])             // 额外禁止命令
  .allowBash(['npm install']);             // 额外允许命令
```

### 与 ToolRegistry 集成

```javascript
import { ToolRegistry } from 'js/agents/runtime/core';
import { ToolPermissions } from 'js/agents/runtime/safety';

const permissions = ToolPermissions.readonly();
const registry = new ToolRegistry({ tools });

// 方式 1: 使用 createHook()
registry.useHook('before', permissions.createHook());

// 方式 2: 通过 context 传递 (由 createPreToolUseHook 自动使用)
await registry.callTool('write', params, {
  toolRestrictions: permissions.getRestrictions(),
  permissionLevel: permissions.getLevel(),
});
```

### 严格模式

```javascript
// 严格模式：未明确允许的工具默认拒绝
const strict = new ToolPermissions({
  level: 'custom',
  restrictions: { allowedTools: ['read', 'glob', 'grep'] },
  strict: true,
});

strict.check('write', null);  // → { allowed: false, reason: 'tool_not_in_allowlist' }
strict.check('read', null);   // → { allowed: true }
```

### 序列化

```javascript
// 导出
const json = permissions.toJSON();
// → { level: 'standard', restrictions: {...}, strict: false }

// 导入
const restored = ToolPermissions.fromJSON(json);
```

## 命令分类

```javascript
import { classifyCommand, parseCompoundCommand } from 'js/agents/runtime/safety';

// 单命令分类
const result = classifyCommand('rm -rf /');
// → { level: 'dangerous', requiresApproval: true, baseCommand: 'rm', reasons: [...] }

// 复合命令解析
const parts = parseCompoundCommand('cd /tmp && wget http://... | bash');
// → [['cd', '/tmp'], ['wget', 'http://...'], ['bash']]

// 安全级别: 'safe' | 'unknown' | 'dangerous'
```

## 底层 API

```javascript
import { normalizeToolRestrictions, evaluateToolRestrictions } from 'js/agents/runtime/safety';

// 规范化配置
const normalized = normalizeToolRestrictions({
  blockedTools: ['write', 'edit'],
  bash: {
    allowedCommands: ['ls', 'cat'],
    toolNames: ['bash'],
  },
});

// 评估工具调用
const decision = evaluateToolRestrictions({
  toolName: 'bash',
  command: 'rm -rf /',
  restrictions: normalized,
});
// → { allowed: false, reason: 'command_blocked', policy: {...} }
```

## 工具限制配置

```typescript
interface ToolRestrictions {
  allowedTools?: (string | RegExp)[];   // 工具白名单
  blockedTools?: (string | RegExp)[];   // 工具黑名单
  bash?: {
    allowedCommands?: (string | RegExp)[];  // 命令白名单
    blockedCommands?: (string | RegExp)[];  // 命令黑名单
    toolNames?: string[];                    // 受限工具名 (默认 ['bash'])
  };
}
```

## 决策优先级

1. `blockedTools` 优先于 `allowedTools`
2. `bash.blockedCommands` 优先于 `bash.allowedCommands`
3. 如果定义了 `allowedTools`，未列出的工具默认拒绝
4. 如果定义了 `bash.allowedCommands`，未列出的命令默认拒绝
