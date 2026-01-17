const LEVEL_PRIORITY = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
});

function normalizeLevel(level) {
  const raw = typeof level === "string" ? level.trim().toLowerCase() : "";
  if (raw && Object.prototype.hasOwnProperty.call(LEVEL_PRIORITY, raw)) return raw;
  return "info";
}

function getConsole() {
  return typeof globalThis !== "undefined" ? globalThis.console : undefined;
}

function pickConsoleFn(consoleObj, level) {
  if (!consoleObj) return null;
  if (level === "debug") return consoleObj.debug || consoleObj.log || null;
  if (level === "info") return consoleObj.info || consoleObj.log || null;
  if (level === "warn") return consoleObj.warn || consoleObj.log || null;
  if (level === "error") return consoleObj.error || consoleObj.log || null;
  return consoleObj.log || null;
}

function formatPrefix({ ts, moduleName, level }) {
  const mod = typeof moduleName === "string" && moduleName.trim() ? moduleName.trim() : "app";
  return `[${ts}] [${mod}] ${String(level).toUpperCase()}:`;
}

/**
 * 创建统一 Logger（debug/info/warn/error），输出包含时间戳与模块前缀。
 * @param {string} moduleName
 * @param {{ level?: string, enabled?: boolean }=} options
 */
export function createLogger(moduleName, options = {}) {
  const { enabled = true, level } = options || {};
  const minLevel = normalizeLevel(level);
  const minPriority = LEVEL_PRIORITY[minLevel];

  const log = (lvl, message, data) => {
    if (!enabled) return;
    const normalizedLevel = normalizeLevel(lvl);
    if (LEVEL_PRIORITY[normalizedLevel] < minPriority) return;

    const consoleObj = getConsole();
    const fn = pickConsoleFn(consoleObj, normalizedLevel);
    if (typeof fn !== "function") return;

    const ts = new Date().toISOString();
    const prefix = formatPrefix({ ts, moduleName, level: normalizedLevel });
    const msg = typeof message === "string" ? message : String(message);

    if (data === undefined) {
      fn(`${prefix} ${msg}`);
      return;
    }

    fn(`${prefix} ${msg}`, data);
  };

  return Object.freeze({
    debug: (msg, data) => log("debug", msg, data),
    info: (msg, data) => log("info", msg, data),
    warn: (msg, data) => log("warn", msg, data),
    error: (msg, data) => log("error", msg, data),
  });
}

export default createLogger;
