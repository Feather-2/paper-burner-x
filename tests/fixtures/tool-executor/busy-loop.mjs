export function handler(args) {
  const durationMs = typeof args?.durationMs === "number" && Number.isFinite(args.durationMs) ? args.durationMs : 500;
  const started = Date.now();
  while (Date.now() - started < durationMs) {
    // busy loop (sync)
  }
  return { ok: true, durationMs };
}

