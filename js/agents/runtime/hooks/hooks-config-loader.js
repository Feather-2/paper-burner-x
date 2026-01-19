import DisposableBase from "../../shared/index.js";
import HookRegistry, { HookEvent, HookType } from "./hook-registry.js";
import { isPlainObject, toNonEmptyString } from "../../shared/index.js";
import { FileWatcher, isNativeWatchSupported } from "../../shared/index.js";
import { createLogger } from "../../shared/index.js";

const logger = createLogger("runtime/hooks/config-loader");

/** @type {Set<string>} */
const VALID_HOOK_EVENTS = new Set(Object.values(HookEvent));

/** @type {Set<string>} */
const VALID_HOOK_TYPES = new Set(Object.values(HookType));

function isMissingPathError(err) {
  const code = String(err?.code || "");
  if (code === "ENOENT") return true;
  const msg = String(err?.message || err || "");
  return msg.includes("ENOENT") || msg.includes("NotFoundError") || msg.includes("NOT_FOUND");
}

function normalizeEventName(input) {
  const raw = toNonEmptyString(input);
  if (!raw) return null;

  if (VALID_HOOK_EVENTS.has(raw)) return raw;

  // Allow enum keys like "PRE_TOOL_USE" / "pre_tool_use".
  const key = raw.replace(/[\s-]+/g, "_").toUpperCase();
  if (Object.prototype.hasOwnProperty.call(HookEvent, key)) return HookEvent[key];

  // Fallback: case-insensitive match against values (e.g., "pretooluse").
  const lower = raw.toLowerCase();
  for (const evt of VALID_HOOK_EVENTS) {
    if (evt.toLowerCase() === lower) return evt;
  }
  return null;
}

async function readTextFromVfs(vfs, path) {
  if (typeof vfs.readText === "function") return await vfs.readText(path);
  if (typeof vfs.readFile !== "function") throw new Error("VFS must provide readText(path) or readFile(path)");
  const bytes = await vfs.readFile(path);
  // TextDecoder is available in modern Node + browsers.
  return new TextDecoder().decode(bytes);
}

/**
 * HooksConfigLoader - loads hooks config from VFS and keeps a HookRegistry in sync.
 *
 * Config is polled (hot reload) via `setInterval`.
 */
export class HooksConfigLoader extends DisposableBase {
  /**
   * @param {object} options
   * @param {any} options.vfs - VFS instance (required)
   * @param {HookRegistry} options.registry - HookRegistry instance (required)
   * @param {string} [options.configPath='.agents/hooks.json'] - Config path in VFS
   * @param {number} [options.pollIntervalMs=2000] - Poll interval for hot reload
   * @param {boolean} [options.useNativeWatch=true] - Prefer native fs.watch when available
   */
  constructor(options) {
    super();

    const o = options && typeof options === "object" ? options : {};
    const vfs = o.vfs;
    const registry = o.registry;

    if (!vfs || typeof vfs !== "object") throw new Error("HooksConfigLoader requires { vfs }");
    if (!registry || typeof registry !== "object") throw new Error("HooksConfigLoader requires { registry }");
    if (registry instanceof HookRegistry === false && (typeof registry.clear !== "function" || typeof registry.register !== "function")) {
      throw new Error("HooksConfigLoader requires { registry } to be a HookRegistry (or compatible)");
    }

    /** @type {any} */
    this._vfs = vfs;

    /** @type {HookRegistry} */
    this._registry = registry;

    /** @type {string} */
    this._configPath = toNonEmptyString(o.configPath) || ".agents/hooks.json";

    const rawInterval = o.pollIntervalMs;
    const intervalMs =
      typeof rawInterval === "number" && Number.isFinite(rawInterval) ? Math.max(250, Math.floor(rawInterval)) : 2000;

    /** @type {number} */
    this._pollIntervalMs = intervalMs;

    /** @type {boolean} */
    this._useNativeWatch = o.useNativeWatch !== false;

    /** @type {number} */
    this._lastModified = 0;

    /** @type {string} */
    this._lastHash = "";

    /** @type {number | NodeJS.Timeout | null} */
    this._watchTimer = null;

    /** @type {FileWatcher | null} */
    this._fileWatcher = null;

    /** @type {Promise<void> | null} */
    this._reloadPromise = null;
  }

  /**
   * Load initial config and start polling for changes.
   * @returns {Promise<void>}
   */
  async init() {
    this._ensureNotDisposed();

    // Initial sync should be authoritative: config file missing => no hooks.
    const { exists, content, mtimeMs } = await this._readConfigFile();
    this._lastModified = exists ? mtimeMs : 0;
    this._lastHash = exists ? this._hashContent(content) : "";

    const cfg = exists ? this._parseConfigContent(content) : null;
    await this.applyConfig(cfg);

    await this.startWatching();
  }

  /**
   * Read config from VFS and parse JSON.
   * @returns {Promise<any|null>} Parsed config object or null (missing/invalid).
   */
  async loadConfig() {
    this._ensureNotDisposed();

    try {
      const text = await readTextFromVfs(this._vfs, this._configPath);
      return this._parseConfigContent(text);
    } catch (err) {
      if (isMissingPathError(err)) return null;
      logger.warn(`[HooksConfigLoader] Failed to read hooks config: ${this._configPath}`, err);
      return null;
    }
  }

  /**
   * Clear the registry and register all hooks from config.
   * @param {any|null} config
   * @returns {Promise<void>}
   */
  async applyConfig(config) {
    this._ensureNotDisposed();

    try {
      this._registry.clear();
    } catch (err) {
      logger.warn("[HooksConfigLoader] Failed to clear hook registry", err);
      return;
    }

    if (!config) return;
    if (!isPlainObject(config)) {
      logger.warn("[HooksConfigLoader] hooks.json root must be an object; ignoring");
      return;
    }

    const hooks = Array.isArray(config.hooks) ? config.hooks : null;
    if (!hooks) {
      if (config.hooks !== undefined) logger.warn("[HooksConfigLoader] hooks.json: 'hooks' must be an array; ignoring");
      return;
    }

    for (let i = 0; i < hooks.length; i++) {
      const raw = hooks[i];
      if (!isPlainObject(raw)) {
        logger.warn(`[HooksConfigLoader] Skipping hooks[${i}]: expected an object`);
        continue;
      }

      const eventName = normalizeEventName(raw.event ?? raw.eventName ?? raw.event_name);
      if (!eventName) {
        logger.warn(`[HooksConfigLoader] Skipping hooks[${i}]: invalid 'event'`);
        continue;
      }

      const type = toNonEmptyString(raw.type)?.toLowerCase();
      if (!type || !VALID_HOOK_TYPES.has(type)) {
        logger.warn(
          `[HooksConfigLoader] Skipping hooks[${i}]: invalid 'type' (expected one of: ${Array.from(VALID_HOOK_TYPES).join(", ")})`
        );
        continue;
      }

      const def = { ...raw };
      delete def.event;
      delete def.eventName;
      delete def.event_name;

      try {
        this._registry.register(eventName, def);
      } catch (err) {
        logger.warn(`[HooksConfigLoader] Skipping hooks[${i}]: failed to register`, err);
      }
    }
  }

  /**
   * Check for config changes; if changed, reload and apply.
   * @returns {Promise<void>}
   */
  async reload() {
    this._ensureNotDisposed();

    // Avoid overlapping reloads (timer-driven).
    if (this._reloadPromise) return await this._reloadPromise;

    this._reloadPromise = (async () => {
      const prevHash = this._lastHash;
      const prevMtime = this._lastModified;

      const { exists, content, mtimeMs } = await this._readConfigFile();

      if (!exists) {
        // Missing config file is OK => no hooks.
        if (prevHash !== "" || prevMtime !== 0) {
          this._lastHash = "";
          this._lastModified = 0;
          await this.applyConfig(null);
        }
        return;
      }

      const nextHash = this._hashContent(content);
      const changed = nextHash !== prevHash || (mtimeMs && mtimeMs !== prevMtime);
      if (!changed) return;

      const parsed = this._parseConfigContent(content);

      // Even if the config is invalid JSON, remember the content so we don't spam warnings.
      this._lastHash = nextHash;
      this._lastModified = mtimeMs;

      // Parse errors return null; keep the last applied config in that case.
      if (parsed === null) return;

      await this.applyConfig(parsed);
    })().finally(() => {
      this._reloadPromise = null;
    });

    return await this._reloadPromise;
  }

  /**
   * Start polling timer for hot reload.
   * @returns {Promise<void>}
   */
  async startWatching() {
    this._ensureNotDisposed();

    if (this._watchTimer || this._fileWatcher) return;

    if (this._useNativeWatch && await isNativeWatchSupported()) {
      this._fileWatcher = new FileWatcher({
        path: this._configPath,
        vfs: this._vfs,
        pollIntervalMs: this._pollIntervalMs,
        onChange: () => {
          this.reload().catch((err) => logger.warn("[HooksConfigLoader] reload failed", err));
        },
      });
      await this._fileWatcher.start();
      return;
    }

    if (!this._pollIntervalMs) return;
    this._watchTimer = setInterval(() => {
      // Ensure errors do not surface as unhandled promise rejections.
      this.reload().catch((err) => logger.warn("[HooksConfigLoader] reload failed", err));
    }, this._pollIntervalMs);
  }

  /**
   * Stop polling timer.
   * @returns {void}
   */
  stopWatching() {
    if (this._fileWatcher) {
      this._fileWatcher.stop();
      this._fileWatcher = null;
    }
    if (!this._watchTimer) return;
    try {
      clearInterval(this._watchTimer);
    } finally {
      this._watchTimer = null;
    }
  }

  _hashContent(content) {
    // FNV-1a 32-bit (fast, stable, good enough for change detection).
    const s = typeof content === "string" ? content : String(content ?? "");
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  /**
   * Stop watching and clear the registry.
   * @returns {Promise<void>}
   */
  async dispose() {
    if (this.disposed) return;
    this.stopWatching();
    try {
      this._registry.clear();
    } catch (err) {
      logger.warn("[HooksConfigLoader] Failed to clear hook registry during dispose", err);
    }
    await super.dispose();
  }

  async _readConfigFile() {
    const path = this._configPath;

    /** @type {number} */
    let mtimeMs = 0;

    if (typeof this._vfs.stat === "function") {
      try {
        const st = await this._vfs.stat(path);
        mtimeMs = typeof st?.mtimeMs === "number" && Number.isFinite(st.mtimeMs) ? st.mtimeMs : 0;
      } catch (err) {
        if (isMissingPathError(err)) return { exists: false, content: "", mtimeMs: 0 };
        // Continue: some VFS backends may not support stat reliably; rely on hashing.
      }
    }

    try {
      const content = await readTextFromVfs(this._vfs, path);
      return { exists: true, content, mtimeMs };
    } catch (err) {
      if (isMissingPathError(err)) return { exists: false, content: "", mtimeMs: 0 };
      logger.warn(`[HooksConfigLoader] Failed to read hooks config: ${path}`, err);
      return { exists: false, content: "", mtimeMs: 0 };
    }
  }

  _parseConfigContent(content) {
    const text = typeof content === "string" ? content : String(content ?? "");
    if (!text.trim()) return null;

    try {
      const parsed = JSON.parse(text);
      if (!isPlainObject(parsed)) {
        logger.warn(`[HooksConfigLoader] hooks config must be a JSON object: ${this._configPath}`);
        return null;
      }
      return parsed;
    } catch (err) {
      logger.warn(`[HooksConfigLoader] Failed to parse hooks config JSON: ${this._configPath}`, err);
      return null;
    }
  }
}

/**
 * @typedef {object} HooksConfigLoaderOptions
 * @property {any} vfs - VFS instance (required)
 * @property {HookRegistry} registry - HookRegistry instance (required)
 * @property {string=} configPath - Config path in VFS (default: '.agents/hooks.json')
 * @property {number=} pollIntervalMs - Poll interval for hot reload (default: 2000)
 * @property {boolean=} useNativeWatch - Prefer native fs.watch when available (default: true)
 */

/**
 * Factory helper.
 * @param {HooksConfigLoaderOptions} options
 * @returns {HooksConfigLoader}
 */
export function createHooksConfigLoader(options) {
  return new HooksConfigLoader(options);
}

export default HooksConfigLoader;
