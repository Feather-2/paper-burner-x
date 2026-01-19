/**
 * Transports (Browser)
 *
 * Browser builds must not eagerly import Node-only modules like `node:child_process`.
 * Provide stubs that fail fast when used.
 */

function notSupported(name) {
  throw new Error(`${name} is not available in browser runtimes.`);
}

export class ProcessTransport {
  constructor() {
    notSupported("ProcessTransport");
  }
}

export function createProcessTransport() {
  notSupported("createProcessTransport");
}

export class BinarySkillProvider {
  constructor() {
    notSupported("BinarySkillProvider");
  }
}

export function createBinarySkillProvider() {
  notSupported("createBinarySkillProvider");
}

export default {
  ProcessTransport,
  createProcessTransport,
  BinarySkillProvider,
  createBinarySkillProvider,
};

