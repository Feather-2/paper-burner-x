# sandbox - WASM 沙箱

基于 QuickJS WASM 的安全执行环境，用于运行不可信 Skill 代码。

## 降级策略（WASM 不可用时）

某些运行环境可能不支持 WebAssembly（或 WASM 沙箱依赖无法加载）。此时：

- `SkillExecutor` 会在无法创建/初始化 WASM 沙箱时，默认降级到受限 JS 执行（best-effort；不是强安全边界）。
- 可通过 `fallbackMode: "none"` 禁用降级，强制要求 WASM 沙箱可用。
- 可通过 `isWasmSupported()` 进行外部能力探测。

## 架构

```
Host (主进程)
    ↓ 消息传递
WasmSandbox (QuickJS WASM)
    ├─ 独立内存空间
    ├─ 资源配额限制
    └─ 能力注入 API
```

## 核心文件

| 文件 | 职责 |
|------|------|
| `wasm-sandbox.js` | WasmSandbox 主类 |
| `pool.js` | SandboxPool 沙箱池 |
| `plugin.js` | createSandboxPlugin |
| `skill-executor.js` | SkillExecutor 技能执行器 |
| `constants.js` | 能力/预设/资源限制常量 |

## 能力 (Capabilities)

```javascript
const SandboxCapability = {
  FETCH: 'fetch',       // 网络请求
  STATE: 'state',       // 状态读写
  EMIT: 'emit',         // 事件发射
  TOOLS: 'tools',       // 工具调用
};
```

## 预设 (Presets)

```javascript
const SandboxPreset = {
  MINIMAL: ['state'],
  STANDARD: ['state', 'emit'],
  FULL: ['state', 'emit', 'fetch', 'tools'],
};
```

## 资源限制

```javascript
const ResourceLimits = {
  DEFAULT: {
    maxMemoryMB: 64,
    maxExecutionMs: 30000,
    maxRecursionDepth: 100,
  },
};
```

## 使用示例

```javascript
import { createSandbox, SkillExecutor, SandboxPreset } from 'js/agents/core/sandbox';

const sandbox = await createSandbox({
  preset: SandboxPreset.STANDARD,
  limits: { maxMemoryMB: 32 },
});

const executor = new SkillExecutor(sandbox);
const result = await executor.execute(skillCode, { input: data });
```
