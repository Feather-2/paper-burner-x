/**
 * Format a value as pretty JSON.
 *
 * Falls back to String(value) when JSON serialization fails (e.g. circular refs).
 */
export function formatJson(value, { space = 2 } = {}) {
  const n = Number.isFinite(space) ? Math.max(0, Math.floor(space)) : 2;
  try {
    return JSON.stringify(value, null, n) ?? "";
  } catch {
    return value == null ? "" : String(value);
  }
}

