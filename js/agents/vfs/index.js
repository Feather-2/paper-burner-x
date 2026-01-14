import { Platform } from "../shared/platform.js";
import { createVfs as createBrowserVfs } from "./index.browser.js";

export * from "./index.browser.js";

/**
 * Create a VFS implementation that works in both Browser and Node.
 *
 * - Browser: prefers OPFS when available
 * - Node: defaults to MemoryVfs unless explicitly requested
 */
export async function createVfs(options = {}) {
  if (!Platform.isNode) {
    return createBrowserVfs(options);
  }

  // Keep Node.js code paths isolated from browser bundlers.
  const node = await import(/* @vite-ignore */ "./index.node.js");
  return node.createVfs(options);
}
