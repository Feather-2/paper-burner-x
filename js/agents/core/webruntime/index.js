/**
 * Webruntime Module
 *
 * 浏览器运行时：开发服务器、HMR、Service Worker、部署等。
 */

// Dev server
export { DevServer, MIME_TYPES } from './dev-server.js';

// HMR
export { HmrClient, createHmrClient } from './hmr.js';

// Server bridge
export { createServerBridge, createFetchHandler } from './server-bridge.js';

// Service Worker handler
export { installFetchHandler } from './sw-handler.js';

// Sandbox deploy
export { generateCspHeader, generateSwScript, generateSandboxFiles } from './sandbox-deploy.js';

// Worker comlink
export { wrapWorker, exposeApi, MSG_CALL, MSG_RETURN, MSG_CONSOLE } from './worker-comlink.js';

// VFS snapshot
export { uint8ToBase64, base64ToUint8, toSnapshot, fromSnapshot, diffSnapshots } from './vfs-snapshot.js';

// VFS events
export { withVfsEvents, createVfsEventBridge } from './vfs-events.js';
