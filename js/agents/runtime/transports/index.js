/**
 * Transports - 外部进程通信层
 *
 * 支持与外部二进制工具通信：
 * - ProcessTransport: Node.js child_process (stdio/JSONL)
 * - BinarySkillProvider: 二进制工具作为 Skills (微架构集成)
 * - (Future) WasmTransport: WebAssembly 模块
 * - (Future) WorkerTransport: Web Worker / Worker Threads
 */

export { ProcessTransport, createProcessTransport } from "./process-transport.js";
export { BinarySkillProvider, createBinarySkillProvider } from "./binary-skill-provider.js";
