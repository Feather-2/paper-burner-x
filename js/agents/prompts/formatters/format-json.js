/**
 * Format a value as pretty JSON.
 *
 * Falls back to String(value) when JSON serialization fails (e.g. circular refs).
 *
 * @param {unknown} value - The value to serialize as JSON.
 * @param {object} [options] - Formatting options.
 * @param {number} [options.space=2] - Number of spaces for indentation (0-10).
 * @param {(error: Error, value: unknown) => void} [options.onError] - Optional callback invoked on serialization failure.
 * @returns {string} The JSON string, or String(value) on failure.
 */
export function formatJson(value, { space = 2, onError } = {}) {
  const n = Number.isFinite(space) ? Math.max(0, Math.floor(space)) : 2;
  try {
    return JSON.stringify(value, null, n) ?? "";
  } catch (err) {
    if (typeof onError === "function") {
      try {
        onError(err, value);
      } catch {
        // Ignore callback errors
      }
    }
    return value == null ? "" : String(value);
  }
}

