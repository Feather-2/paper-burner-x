/**
 * ServiceProvider interface for MicroKernel.
 *
 * @deprecated Since 1.0.0, will be removed in 2.0.0
 * Use createPlugin() from 'js/agents/core' instead:
 *
 * ```javascript
 * // Before (deprecated)
 * class MyProvider extends ServiceProvider {
 *   async register(kernel) { ... }
 * }
 *
 * // After (recommended)
 * import { createPlugin } from 'js/agents/core';
 * const myPlugin = createPlugin({
 *   name: 'my-plugin',
 *   install(ctx) { ... }
 * });
 * ```
 */

// Re-export isServiceProvider from core/compat
export { isServiceProvider } from '../../core/compat.js';

/**
 * @deprecated Use createPlugin() instead
 */
export class ServiceProvider {
  /**
   * Register services into the kernel/container.
   * @param {any} _kernel
   * @returns {Promise<void>}
   */
  async register(_kernel) {
    throw new Error("ServiceProvider.register(kernel) not implemented");
  }

  /**
   * Optional lifecycle hook called after all providers have registered.
   * @param {any} _kernel
   * @returns {Promise<void>}
   */
  async start(_kernel) {}

  /**
   * Optional lifecycle hook called when the kernel stops.
   * @param {any} _kernel
   * @returns {Promise<void>}
   */
  async stop(_kernel) {}
}
