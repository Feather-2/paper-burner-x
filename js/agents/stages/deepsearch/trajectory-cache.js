// 浏览器兼容的哈希函数（不需要加密安全性，仅用于缓存 key）
function simpleHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// 浏览器环境使用简单哈希（djb2 变体）
function browserHash(s) {
  const str = String(s);
  return simpleHash(str) + simpleHash(str.slice(Math.floor(str.length / 2))) + simpleHash(str.slice(0, Math.floor(str.length / 3)));
}

// 环境检测：浏览器直接用 browserHash，Node.js 用 crypto
const isBrowser = typeof window !== "undefined" || typeof process === "undefined" || !process.versions?.node;

let sha256Hex;
if (isBrowser) {
  sha256Hex = browserHash;
} else {
  // Node.js 环境：同步导入 crypto
  const { createHash } = await import("node:crypto");
  sha256Hex = (s) => createHash("sha256").update(String(s)).digest("hex");
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function stableStringify(value) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string") return JSON.stringify(value);
  if (t === "number") return Number.isFinite(value) ? String(value) : "null";
  if (t === "boolean") return value ? "true" : "false";
  if (t === "bigint") return JSON.stringify(String(value));
  if (t === "undefined") return "null";
  if (t === "function" || t === "symbol") return "null";

  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;

  if (value instanceof Map) {
    const entries = [...value.entries()].map(([k, v]) => [String(k), v]).sort((a, b) => a[0].localeCompare(b[0]));
    return stableStringify(Object.fromEntries(entries));
  }

  if (!isPlainObject(value)) return JSON.stringify(String(value));

  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`);
  return `{${parts.join(",")}}`;
}

export class TrajectoryCache {
  constructor(opts = {}) {
    this.schemaVersion = typeof opts.schemaVersion === "number" && Number.isFinite(opts.schemaVersion) ? Math.floor(opts.schemaVersion) : 1;
    this.maxSize = typeof opts.maxSize === "number" && Number.isFinite(opts.maxSize) && opts.maxSize >= 1 ? Math.floor(opts.maxSize) : 100;
    this.cache = new Map(); // key -> value (LRU order via insertion)
    this.inflight = new Map(); // key -> Promise
  }

  computeKey(stageName, inputs, llm = {}) {
    const model = typeof llm?.model === "string" ? llm.model : null;
    const temperature = typeof llm?.temperature === "number" && Number.isFinite(llm.temperature) ? llm.temperature : null;
    const payload = {
      schemaVersion: this.schemaVersion,
      stageName: String(stageName || ""),
      model,
      temperature,
      inputs: inputs ?? null,
    };
    return sha256Hex(stableStringify(payload));
  }

  async getOrCompute(key, computeFn) {
    const k = String(key || "");
    if (!k) throw new TypeError("TrajectoryCache.getOrCompute(key, computeFn): key must be a non-empty string");
    if (typeof computeFn !== "function") throw new TypeError("TrajectoryCache.getOrCompute(key, computeFn): computeFn must be a function");

    if (this.cache.has(k)) {
      const v = this.cache.get(k);
      this.cache.delete(k);
      this.cache.set(k, v);
      return v;
    }

    if (this.inflight.has(k)) return this.inflight.get(k);

    const p = (async () => {
      try {
        const v = await computeFn();
        this.cache.set(k, v);
        while (this.cache.size > this.maxSize) {
          const oldestKey = this.cache.keys().next().value;
          this.cache.delete(oldestKey);
        }
        return v;
      } finally {
        this.inflight.delete(k);
      }
    })();

    this.inflight.set(k, p);
    return p;
  }

  invalidate(key) {
    const k = String(key || "");
    if (!k) return;
    this.cache.delete(k);
    this.inflight.delete(k);
  }

  clear() {
    this.cache.clear();
    this.inflight.clear();
  }
}

export const __test = {
  stableStringify,
  sha256Hex,
};

