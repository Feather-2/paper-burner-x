/**
 * ServiceProvider interface for MicroKernel.
 *
 * A provider is responsible for registering services into the kernel/container,
 * and may optionally participate in lifecycle start/stop.
 */

export class ServiceProvider {
  async register(_kernel) {
    throw new Error("ServiceProvider.register(kernel) not implemented");
  }

  async start(_kernel) {}

  async stop(_kernel) {}
}

export function isServiceProvider(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.register === "function"
  );
}

