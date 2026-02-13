/**
 * Node-compat Module
 *
 * Node.js 兼容层：shims、require 系统、模块解析、npm 包管理等。
 */

// Shims
export { createBuiltinModules, BUILTIN_MODULE_NAMES } from './shims/index.js';

// Require / Module resolution
export { createRequire } from './require.js';
export { createResolver } from './module-resolver.js';

// ESM transform
export { hasESMSyntax, transformESMtoCJS } from './transform-esm.js';

// Node env factory
export { createNodeEnv } from './create-node-env.js';

// Sandbox tool (ToolExecutor integration)
export { createSandboxTool, SANDBOX_TOOL_DEFINITION } from './sandbox-tool.js';

// CORS proxy
export { createCorsProxy, setCorsProxy, getCorsProxy, buildProxyUrl, proxyFetch } from './cors-proxy.js';

// REPL
export { createREPL } from './repl.js';

// VFS adapter
export { createVfsAdapter } from './vfs-adapter.js';

// Quota & Observability
export { QuotaEnforcer } from './quota.js';
export { ObservabilityStream, withObservability } from './observability.js';
export { detectAvailableModes, selectExecutionMode, createExecutionContext } from './execution-strategy.js';

// npm package manager
export { PackageManager } from './npm/index.js';

// Polyfills
export { parseStack, createCallSite, installStackTracePolyfill, RAW_STACK } from './polyfills/stack-trace.js';
export { ExtendedTextDecoder, installPolyfill } from './polyfills/text-decoder.js';
