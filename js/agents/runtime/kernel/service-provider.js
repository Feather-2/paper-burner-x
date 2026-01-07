/**
 * ServiceProvider interface for MicroKernel.
 *
 * A provider is responsible for registering services into the kernel/container,
 * and may optionally participate in lifecycle start/stop.
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

/**
 * @param {unknown} value
 * @returns {value is ServiceProvider}
 */
export function isServiceProvider(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.register === "function"
  );
}
