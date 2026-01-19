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
