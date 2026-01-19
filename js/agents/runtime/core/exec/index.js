/**
 * exec - 命令执行器入口
 *
 * Node.js: 导出真实实现
 * Browser: 导出 stub（所有函数返回失败或抛错）
 *
 * 构建工具应通过 package.json exports 或 browser field 选择正确版本。
 */

import * as nodeImpl from './command-executor.node.js';
import * as browserImpl from './command-executor.browser.js';

const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";
const impl = isBrowser ? browserImpl : nodeImpl;

export const exec = impl.exec;
export const execShell = impl.execShell;
export const execSimple = impl.execSimple;
export const commandExists = impl.commandExists;
export default impl.default || impl;
