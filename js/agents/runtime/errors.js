/**
 * Runtime Errors - Sub-path export
 *
 * Usage: import { SilentErrorReporter } from 'js/agents/runtime/errors';
 */

export {
  SilentErrorReporter,
  ErrorCategory,
  silentErrors,
  reportSilentError,
  createScopedReporter,
} from "./core/errors/index.js";
