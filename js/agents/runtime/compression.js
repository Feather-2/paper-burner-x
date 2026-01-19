/**
 * Runtime Compression - Sub-path export
 *
 * Usage: import { Watchdog, CicadaCompressor } from 'js/agents/runtime/compression';
 */

export { Watchdog } from "../plugins/compression/impl/watchdog.js";
export { CicadaCompressor, CompressionLayer } from "../plugins/compression/impl/cicada-compressor.js";
export { CompressionCoordinator } from "../plugins/compression/impl/coordinator.js";
export { ContextPredictor } from "../plugins/compression/impl/context-predictor.js";
export { AdaptiveZoneManager } from "../plugins/compression/impl/adaptive-zone-manager.js";
export {
  ProactiveCompressor,
  PRESETS as PROACTIVE_PRESETS,
  autoSelectPreset as autoSelectProactivePreset,
} from "../plugins/compression/impl/proactive-compressor.js";
export { CompressionQualityMonitor } from "../plugins/compression/impl/quality-monitor.js";
