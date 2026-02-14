# sandbox - 沙箱隔离系统

提供沙箱隔离核心能力（WASM + System + Browser Bridge），并与 `node-compat`、`webruntime` 两个模块协同工作。

## 模块拆分

> 自 commit `03d6fab6` 起，原 `sandbox/` 拆分为三个职责清晰的模块：

| 模块 | 路径 | 职责 |
|------|------|------|
| **sandbox** | `./` | 隔离核心（能力模型、资源限制、工厂、WASM/System/iframe 适配） |
| **node-compat** | `../node-compat/` | Node.js 兼容层（require/module-resolver/shims/npm/ToolExecutor 集成） |
| **webruntime** | `../webruntime/` | 浏览器运行时（dev-server/HMR/SW/worker bridge/VFS snapshot/events） |

## 架构

```text
createSandbox(level='auto')
        │
        ├─ validateConfig()
        ├─ AUTO_PRIORITY 探测
        │    ├─ wasm
        │    ├─ worker
        │    ├─ iframe
        │    └─ main-thread（最后回退）
        │
        └─ wrapAsSandbox()
             ├─ execute(code, filename)
             ├─ runFile(path)
             ├─ terminate()
             └─ terminated
```

> `index.js` 作为统一入口：浏览器可安全导入 WASM 相关导出与 system 常量；System Sandbox 在浏览器环境抛出明确错误，在 Node-like 环境通过动态 import 延迟加载。

## 能力模型（`constants.js`）

### SandboxCapability

| 能力 | 说明 | 风险 |
|------|------|------|
| `console` | 日志输出 | low |
| `state` | 只读状态访问 | low |
| `emit` | 事件发射 | medium |
| `fetch` | 受限网络访问 | medium |
| `fs:read` | 文件只读访问 | medium |
| `fs:write` | 文件写入 | high |
| `exec` | 子进程执行 | critical |

### SandboxPreset

| 预设 | 组合 |
|------|------|
| `MINIMAL` | `console` |
| `SKILL` | `console` + `state` + `emit` |
| `NETWORK` | `SKILL` + `fetch` |
| `TRUSTED` | 全能力（含 `fs:write`、`exec`） |

> 默认使用最小权限预设；`TRUSTED` 仅允许可信插件/技能。

## 资源限制（`ResourceLimits`）

- 内置 `LIGHT`（1MB / 1s / stack 100）与 `STANDARD`（8MB / 30s / stack 500）等预设。
- 各后端应在创建阶段绑定资源限制，避免自动回退路径绕过限制。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 统一入口（含向后兼容重导出） |
| `constants.js` | 能力枚举、预设、资源限制预设（深冻结） |
| `sandbox-interface.js` | 接口定义、配置校验、`AUTO_PRIORITY` |
| `create-sandbox.js` | 三层工厂与统一 Sandbox 包装 |
| `wasm-sandbox.js` | QuickJS WASM 沙箱主实现 |
| `iframe-eval-bridge.js` | sandboxed iframe 内执行 eval 链并回传结果 |
| `iframe-sandbox.js` | iframe 沙箱执行器 |
| `system/*` | 系统级沙箱实现 |

## iframe Eval Bridge 协议

- Host -> iframe: `{ type: 'eval', id, code, filename }`
- iframe -> Host: `{ type: 'eval-result', id, ok, value, error }`
- iframe 使用 `sandbox=allow-scripts`（不启用 same-origin）隔离主页面敏感能力。
- 必须校验消息来源与请求 id，避免跨窗口消息伪造。

## 安全边界与约束

- 能力模型与资源限制属于安全边界，插件运行时不得动态放宽。
- `runFile(path)` 必须叠加 VFS 根路径白名单与路径规范化。
- 默认错误返回不透出内部堆栈，堆栈仅进入 debug/telemetry 通道。
- `terminate()` 必须保持幂等，并明确并发 `execute/terminate` 的行为语义。

## 测试建议（优先）

1. 状态机转换：`created -> running -> terminated` 与重复终止。
2. 并发安全：`execute` 与 `terminate` 并发调用。
3. 权限矩阵：`SandboxPreset` 允许/拒绝行为验证。
4. 资源边界：超时、栈深、内存上限触发行为。
5. 消息桥接：source/origin/id 校验与重放防护。
