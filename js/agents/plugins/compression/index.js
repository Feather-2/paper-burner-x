/**
 * Compression 模块导出
 */

// Plugins
export { default as cicadaPlugin } from "./cicada.js";
export { default as watchdogPlugin } from "./watchdog.js";

// Core implementations
export { CicadaCompressor, CompressionLayer } from "./impl/cicada-compressor.js";
export { Watchdog } from "./impl/watchdog.js";
export { ProactiveCompressor } from "./impl/proactive-compressor.js";
export { CompressionCoordinator } from "./impl/coordinator.js";
export { AdaptiveZoneManager } from "./impl/adaptive-zone-manager.js";
export { CompressionQualityMonitor } from "./impl/quality-monitor.js";
export { ContextPredictor } from "./impl/context-predictor.js";

// Async utilities
export {
  default as compressSessionHistoryAsync,
  terminateCompressionWorker,
  isCompressionWorkerAvailable,
} from "./impl/compression-async.js";
