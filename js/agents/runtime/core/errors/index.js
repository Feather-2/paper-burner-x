/**
 * Error handling utilities
 * @module runtime/errors
 */

export {
  SilentErrorReporter,
  ErrorCategory,
  silentErrors,
  reportSilentError,
  createScopedReporter,
} from './silent-error-reporter.js';

export { computeErrorFingerprint, normalizeMessage, extractTopFrames } from './error-fingerprint.js';
export { ErrorTaxonomy, classifyError } from './error-taxonomy.js';
export { ErrorAggregator } from './error-aggregator.js';
