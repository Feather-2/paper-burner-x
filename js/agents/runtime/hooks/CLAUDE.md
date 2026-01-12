# hooks - 钩子系统

工具调用前后的拦截和处理。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口，导出所有钩子 API |
| `hook-registry.js` | HookRegistry - 钩子注册表 |
| `pre-tool-hook.js` | Pre-Tool 钩子 |
| `post-tool-hook.js` | Post-Tool 钩子 |

## 钩子类型

```javascript
const HookType = {
  PRE_TOOL_USE: 'pre_tool_use',
  POST_TOOL_USE: 'post_tool_use',
  PRE_LLM_CALL: 'pre_llm_call',
  POST_LLM_CALL: 'post_llm_call',
};
```

## 使用示例

```javascript
import { HookRegistry, HookType, createPreToolUseHook } from 'js/agents/runtime/hooks';

const registry = new HookRegistry();

// 注册 Pre-Tool 钩子
registry.register(HookType.PRE_TOOL_USE, createPreToolUseHook((toolName, args) => {
  if (toolName === 'bash') {
    const classification = classifyCommand(args.command);
    if (classification.risk === 'high') {
      return { allow: false, reason: 'High risk command blocked' };
    }
  }
  return { allow: true };
}));

// 注册 Post-Tool 钩子
registry.register(HookType.POST_TOOL_USE, (toolName, args, result) => {
  trackToolCall(toolName, args, result);
});
```

## 与 EventBus 集成

```javascript
import { enhanceEventBusWithHooks } from 'js/agents/runtime/hooks';

const enhancedBus = enhanceEventBusWithHooks(eventBus, hookRegistry);
```
