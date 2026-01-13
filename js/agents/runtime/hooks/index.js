export { HookRegistry, HookType, HookEvent } from "./hook-registry.js";
export { enhanceEventBusWithHooks, getHookRegistry } from "./event-bus-hooks.js";
export { createPreToolUseHook, createPreAgentHook, createPostAgentHook } from "./hook-runner.js";

// MiddlewareChain 统一从 middleware/ 导出，此处保留向后兼容
export { MiddlewareChain, Stage } from "../middleware/middleware-chain.js";
