# Polyfills (node-compat)

## 模块定位
Browser-first 的 Node/V8 兼容层，为 `js/agents` 运行时补齐在 Safari/Firefox 等环境缺失的能力。

## 目录职责
| 文件 | 作用 | 关键能力 |
| --- | --- | --- |
| `stack-trace.js` | `Error.captureStackTrace` 跨浏览器兼容 | 解析 V8/Safari 栈格式，构造 CallSite 兼容对象 |
| `text-decoder.js` | `TextDecoder` 增强与编码别名兼容 | 标准编码别名归一化，扩展 `base64/base64url/hex` |

## 设计约束
- 仅在原生能力缺失时启用 polyfill，避免覆盖宿主实现。
- 保持 ES Modules + Browser-first，不依赖 `fs`/`path`/`process`/`child_process`。
- 输入先做归一化（`ArrayBuffer` / `ArrayBufferView` / `Uint8Array`）。
- 非法输入抛出明确错误，禁止静默失败。

## 安全与稳定性基线
- 禁止 `eval` / `new Function` / 动态脚本执行。
- 禁止未转义输入进入 DOM（本目录保持纯计算）。
- 全局补丁必须幂等，重复安装不应污染内核全局状态。
- 为大输入增加边界保护（建议：`MAX_STACK_CHARS`、`MAX_STACK_FRAMES`、`MAX_DECODE_BYTES`）。

## JSDoc 约定
- Public API 必须完整声明 `@param`、`@returns`、`@throws`（含描述）。
- 复杂结构统一用 `@typedef`（如 `CallSite`）。
- 私有函数显式标记 `/** @private */`。

## 最低测试清单
- 栈格式兼容：V8/Safari/Firefox 栈字符串解析一致性。
- 编码兼容：`utf-8`、`utf-16le`、`ascii`、`latin1`、`base64`、`base64url`、`hex`。
- 边界输入：`null`、空数组、超长字符串、超大字节数组。
- 并发与幂等：重复安装 polyfill 不破坏全局状态。
- 资源回收：无残留监听器、无长期持有大对象引用。