/** Default max snapshots before eviction */
export const DEFAULT_MAX_SNAPSHOTS = 1000;
/** Default max storage bytes (100MB) */
export const DEFAULT_MAX_STORAGE_BYTES = 100 * 1024 * 1024;
/** Estimated bytes per character in summary (UTF-8 avg) */
export const BYTES_PER_CHAR = 2;
/** Base overhead per snapshot entry (id, ts, stageKey, accessedAt, etc.) */
export const ENTRY_OVERHEAD_BYTES = 200;
