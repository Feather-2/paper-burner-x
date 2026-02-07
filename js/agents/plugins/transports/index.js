/**
 * Transports - 外部进程通信层
 *
 * 支持与外部二进制工具通信：
 * - ProcessTransport: Node.js child_process (stdio/JSONL)
 * - BinarySkillProvider: 二进制工具作为 Skills (微架构集成)
 * - (Future) WasmTransport: WebAssembly 模块
 * - (Future) WorkerTransport: Web Worker / Worker Threads
 */

import { Platform } from "../../shared/index.js";

let _impl = null;

async function getImpl() {
  if (!_impl) {
    _impl = Platform.isNode
      ? await import("./index.node.js")
      : await import("./index.browser.js");
  }
  return _impl;
}

export { getImpl };

export async function getProcessTransport() {
  return (await getImpl()).ProcessTransport;
}
export async function createProcessTransport(...args) {
  const mod = await getImpl();
  return mod.createProcessTransport(...args);
}
export async function getBinarySkillProvider() {
  return (await getImpl()).BinarySkillProvider;
}
export async function createBinarySkillProvider(...args) {
  const mod = await getImpl();
  return mod.createBinarySkillProvider(...args);
}

export default { getImpl, getProcessTransport, createProcessTransport, getBinarySkillProvider, createBinarySkillProvider };
