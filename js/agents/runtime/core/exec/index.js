/**
 * exec - 命令执行器入口
 *
 * Node.js: 导出真实实现
 * Browser: 导出 stub（所有函数返回失败或抛错）
 *
 * 构建工具应通过 package.json exports 或 browser field 选择正确版本。
 */

// 默认导出 Node 版本；浏览器构建应替换为 .browser.js
export { exec, execShell, execSimple, commandExists } from './command-executor.node.js';
export { default } from './command-executor.node.js';
