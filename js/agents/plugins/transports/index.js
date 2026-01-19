/**
 * Transports - 外部进程通信层
 *
 * 支持与外部二进制工具通信：
 * - ProcessTransport: Node.js child_process (stdio/JSONL)
 * - BinarySkillProvider: 二进制工具作为 Skills (微架构集成)
 * - (Future) WasmTransport: WebAssembly 模块
 * - (Future) WorkerTransport: Web Worker / Worker Threads
 */

import { Platform } from "../../shared/platform.js";

const impl = Platform.isNode ? await import("./index.node.js") : await import("./index.browser.js");

export const ProcessTransport = impl.ProcessTransport;
export const createProcessTransport = impl.createProcessTransport;
export const BinarySkillProvider = impl.BinarySkillProvider;
export const createBinarySkillProvider = impl.createBinarySkillProvider;

export default impl;
