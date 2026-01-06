/**
 * Legacy Kernel Module
 *
 * @deprecated Since 1.0.0, will be removed in 2.0.0
 * @migration Use `import { Kernel } from 'js/agents/core'` instead
 *
 * Migration guide:
 * - MicroKernel → Kernel
 * - kernel.container.get(id) → kernel.services.get(id)
 * - kernel.use(provider) → kernel.use(plugin)
 * - ServiceProvider → createPlugin()
 */

export { MicroKernel } from "./micro-kernel.js";
export { MessageBus } from "./message-bus.js";
export { ServiceProvider, isServiceProvider } from "./service-provider.js";
