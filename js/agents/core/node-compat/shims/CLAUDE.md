# js/agents/core/node-compat/shims

**Browser-first Node API 兼容层** —— 为 Agent 微内核提供最小可用 Node 核心模块替代实现。

## 模块定位

- 路径：`js/agents/core/node-compat/shims`
- 目标：在浏览器环境下提供 `assert` / `async_hooks` / `buffer` 的可运行替代
- 非目标：不追求与 Node.js 100% 行为一致；不作为安全隔离边界

## 模块清单

| 文件 | 导出 | 说明 |
|------|------|------|
| `assert.js` | `AssertionError` + assert API | 断言与深比较能力 |
| `async_hooks.js` | `AsyncResource`, `AsyncLocalStorage`, `createHook` | 浏览器下的降级异步上下文 |
| `buffer.js` | `Buffer` | `Uint8Array` 封装与常用编码转换 |

## 设计约束

- ES Modules + JSDoc（无 TypeScript）
- Browser-first，Node.js compatible（降级兼容）
- 无 Node-only 依赖（`fs` / `path` / `process` / `child_process`）
- 纯 shim：尽量无副作用、无全局污染

## 行为差异（必须知晓）

- `AsyncLocalStorage` 为轻量实现，不能等价替代 Node 的异步上下文传播
- `AsyncResource.asyncId()` / `triggerAsyncId()` 固定返回 `0`
- `createHook()` 仅提供 no-op 钩子对象，不提供真实生命周期追踪
- `Buffer` 仅覆盖常用路径（`utf8` / `base64` / `hex` / `ascii` 等），边界输入需调用方自行校验
- `assert` 深比较能力为 shim 语义，极端对象图（超深/循环）需谨慎使用

## 安全与稳定性约定

- 禁止把该目录 shim 当作权限边界或沙箱机制
- 插件执行上下文不要仅依赖 `AsyncLocalStorage` 做隔离判定
- 所有外部输入在进入 `Buffer.from()` 前必须完成类型与格式校验
- 断言错误信息不得直接泄露敏感对象内容（必要时脱敏）

## 测试基线

- 覆盖率目标：≥90%（最低 70%）
- 必测场景：
  - 空值与类型边界：`null` / `undefined` / `''` / `[]` / `{}`、字符串数字混用
  - 编码边界：非法 `base64`、奇数位 `hex`、超长输入
  - 并发边界：并行 `run` / `enterWith` / `exit` 调用
  - 生命周期：`createHook().enable/disable`、`AsyncResource.runInAsyncScope`
  - 稳定性：深层对象比较、循环引用输入、快速连续调用

## 维护规则

- 新增 shim 时同步更新本文件的模块清单与行为差异
- 对外可见 API 必须补全 JSDoc（`@param` / `@returns` / `@throws`）
- 若引入 Node fallback，请显式标注 Browser/Node 分支行为