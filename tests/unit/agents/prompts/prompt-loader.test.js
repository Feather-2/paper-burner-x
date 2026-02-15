import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

vi.mock("../../../../js/agents/shared/index.js", () => ({
  createLogger: vi.fn(),
  protoSafeReviver: (key, value) => value,
  isPlainObject: vi.fn(),
  toNonEmptyString: vi.fn(),
  isNodeLike: vi.fn(),
}));

const modulePath = "../../../../js/agents/prompts/prompt-loader.js";
const sharedPath = "../../../../js/agents/shared/index.js";

let isNodeLikeValue = true;
let createdLoggers = [];

const toNonEmptyStringImpl = (value) => {
  if (value === null || value === undefined) return "";
  const s = String(value).trim();
  return s ? s : "";
};

const isPlainObjectImpl = (value) => {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "prompt-loader-"));

const writePrompt = (dir, name, content) => {
  const filename = name.endsWith(".md") ? name : `${name}.md`;
  const filePath = path.join(dir, filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
};

const removeDir = (dir) => {
  fs.rmSync(dir, { recursive: true, force: true });
};

const deferred = () => {
  /** @type {(v?: any) => void} */
  let resolve;
  /** @type {(e?: any) => void} */
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  isNodeLikeValue = true;
  createdLoggers = [];

  const shared = await import(sharedPath);
  shared.createLogger.mockImplementation((name) => {
    const logger = { debug: vi.fn(), warn: vi.fn() };
    createdLoggers.push({ name, logger });
    return logger;
  });
  shared.isPlainObject.mockImplementation(isPlainObjectImpl);
  shared.toNonEmptyString.mockImplementation(toNonEmptyStringImpl);
  shared.isNodeLike.mockImplementation(() => isNodeLikeValue);
});

describe("PromptLoader", () => {
  it("loads prompts, trims content, caches with LRU, and handles concurrent calls", async () => {
    const { PromptLoader } = await import(modulePath);
    const tempDir = makeTempDir();

    try {
      writePrompt(tempDir, "a", "  hello  ");
      writePrompt(tempDir, "b", "world");

      const loader = new PromptLoader({ basePath: tempDir, maxEntries: 1 });
      const [first, second] = await Promise.all([loader.loadPrompt("a"), loader.loadPrompt("a")]);

      expect(first).toBe("hello");
      expect(second).toBe("hello");
      expect(loader.getCachedPromptNames()).toEqual(["a"]);

      await loader.loadPrompt("b");
      expect(loader.getCachedPromptNames()).toEqual(["b"]);
    } finally {
      removeDir(tempDir);
    }
  });

  it("normalizes cache config values and rejects invalid inputs", async () => {
    const { PromptLoader } = await import(modulePath);
    const loader = new PromptLoader();

    const config = loader.configureCache({ maxEntries: "2", manifestTtlMs: Number.MAX_SAFE_INTEGER });
    expect(config.maxEntries).toBe(2);
    expect(config.manifestTtlMs).toBe(Number.MAX_SAFE_INTEGER);

    const configNegative = loader.configureCache({ maxEntries: -1 });
    expect(configNegative.maxEntries).toBe(0);

    expect(() => new PromptLoader({ maxEntries: "nope" })).toThrow(/maxEntries/);
    expect(() => loader.configureCache({ manifestTtlMs: "bad" })).toThrow(/manifestTtlMs/);
  });

  it("enforces maxPromptBytes for oversized files", async () => {
    const { PromptLoader } = await import(modulePath);
    const tempDir = makeTempDir();

    try {
      writePrompt(tempDir, "big", "x".repeat(64));
      const loader = new PromptLoader({ basePath: tempDir, maxPromptBytes: 10 });

      await expect(loader.loadPrompt("big")).rejects.toThrow(/Prompt content exceeds limit/);
    } finally {
      removeDir(tempDir);
    }
  });

  it("returns cached content in loadPromptSync without sync fs access", async () => {
    const { PromptLoader } = await import(modulePath);
    const tempDir = makeTempDir();

    try {
      writePrompt(tempDir, "cached", "  cached value  ");
      const loader = new PromptLoader({ basePath: tempDir });
      const asyncValue = await loader.loadPrompt("cached");
      const syncValue = loader.loadPromptSync("cached");

      expect(syncValue).toBe(asyncValue);
    } finally {
      removeDir(tempDir);
    }
  });

  it("enforces maxManifestBytes when fetching manifest JSON", async () => {
    const { PromptLoader } = await import(modulePath);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => "x".repeat(32),
    }));

    const loader = new PromptLoader({ fetchImpl, maxManifestBytes: 10 });

    await expect(loader._fetchJson("https://example.com/manifest.json")).rejects.toThrow(
      /Prompt manifest exceeds limit/
    );
  });

  it("deduplicates concurrent manifest loads for the same URL", async () => {
    isNodeLikeValue = false;
    const { PromptLoader } = await import(modulePath);
    const gate = deferred();
    const manifestUrl = "https://example.com/prompts/manifest.json";
    const fetchImpl = vi.fn(async () => {
      await gate.promise;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ prompts: [{ name: "demo", path: "demo.md" }] }),
      };
    });

    const loader = new PromptLoader({ fetchImpl, manifestTtlMs: 60_000 });
    const first = loader._loadPromptManifest(manifestUrl);
    const second = loader._loadPromptManifest(manifestUrl);

    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    gate.resolve();
    const [m1, m2] = await Promise.all([first, second]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(m1?.url).toBe(manifestUrl);
    expect(m2).toBe(m1);
    expect(m1?.byName.get("demo")).toEqual({ name: "demo", path: "demo.md" });

    const cached = await loader._loadPromptManifest(manifestUrl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cached).toBe(m1);
  });
});

describe("configurePromptCache", () => {
  it("returns normalized cache config for boundary values", async () => {
    const { configurePromptCache } = await import(modulePath);

    const config = configurePromptCache({ maxEntries: "0", manifestTtlMs: Number.MAX_SAFE_INTEGER });

    expect(config.maxEntries).toBe(0);
    expect(config.manifestTtlMs).toBe(Number.MAX_SAFE_INTEGER);
    expect(config.size).toBe(0);
  });

  it("throws on invalid values", async () => {
    const { configurePromptCache } = await import(modulePath);

    expect(() => configurePromptCache({ maxEntries: "NaN" })).toThrow(/maxEntries/);
  });
});

describe("loadPrompt", () => {
  it("loads an existing prompt and supports concurrent calls", async () => {
    const { loadPrompt } = await import(modulePath);
    const promptPath = path.join(process.cwd(), "js/agents/prompts/design/svg-generator.md");
    const expected = fs.readFileSync(promptPath, "utf-8").trim();

    const [first, second] = await Promise.all([loadPrompt("design/svg-generator"), loadPrompt("design/svg-generator")]);

    expect(first).toBe(expected);
    expect(second).toBe(expected);
  });

  it("rejects invalid keys and handles empty or null names", async () => {
    const { loadPrompt } = await import(modulePath);

    await expect(loadPrompt("")).rejects.toThrow(/Invalid prompt key/);
    await expect(loadPrompt("   ")).rejects.toThrow(/Invalid prompt key/);
    await expect(loadPrompt("../escape")).rejects.toThrow(/Invalid prompt key/);
    await expect(loadPrompt(null)).rejects.toThrow(/Failed to load prompt "null"/);
    await expect(loadPrompt(undefined)).rejects.toThrow(/Failed to load prompt "undefined"/);
  });
});

describe("loadPromptSync", () => {
  it("returns cached value after async load", async () => {
    const { loadPrompt, loadPromptSync, clearPromptCache } = await import(modulePath);

    const asyncValue = await loadPrompt("design/svg-generator");
    const syncValue = loadPromptSync("design/svg-generator");

    expect(syncValue).toBe(asyncValue);

    clearPromptCache("design/svg-generator");
  });

  it("throws on invalid keys and in browser environment", async () => {
    const { loadPromptSync } = await import(modulePath);

    expect(() => loadPromptSync("../bad")).toThrow(/Invalid prompt key/);

    const originalWindow = globalThis.window;
    globalThis.window = {};
    try {
      expect(() => loadPromptSync("design/svg-generator")).toThrow(/not supported in browser environment/);
    } finally {
      if (originalWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = originalWindow;
      }
    }
  });
});

describe("preloadPrompts", () => {
  it("preloads valid prompts and skips failures", async () => {
    const { preloadPrompts } = await import(modulePath);
    const promptPath = path.join(process.cwd(), "js/agents/prompts/design/svg-generator.md");
    const expected = fs.readFileSync(promptPath, "utf-8").trim();

    const map = await preloadPrompts(["design/svg-generator", "../missing"]);

    expect(map.get("design/svg-generator")).toBe(expected);
    expect(map.has("../missing")).toBe(false);
  });

  it("handles empty arrays and non-array inputs", async () => {
    const { preloadPrompts } = await import(modulePath);

    const empty = await preloadPrompts([]);
    const nonArray = await preloadPrompts({});

    expect(empty.size).toBe(0);
    expect(nonArray.size).toBe(0);
  });
});

describe("clearPromptCache", () => {
  it("clears individual entries and entire cache", async () => {
    const { loadPrompt, clearPromptCache, getCachedPromptNames } = await import(modulePath);

    await loadPrompt("design/svg-generator");
    await loadPrompt("design/brainstorm-system");

    const initial = getCachedPromptNames().sort();
    expect(initial).toEqual(["design/brainstorm-system", "design/svg-generator"].sort());

    clearPromptCache("design/svg-generator.md");
    const remaining = getCachedPromptNames();
    expect(remaining).toEqual(["design/brainstorm-system"]);

    clearPromptCache();
    expect(getCachedPromptNames()).toEqual([]);
  });
});

describe("getCachedPromptNames", () => {
  it("returns empty array when cache is empty and unique names when cached", async () => {
    const { loadPrompt, getCachedPromptNames } = await import(modulePath);

    expect(getCachedPromptNames()).toEqual([]);

    await loadPrompt("design/svg-generator");
    await loadPrompt("design/svg-generator");

    const names = getCachedPromptNames();
    expect(names).toEqual(["design/svg-generator"]);
  });
});

describe("renderPromptTemplate", () => {
  it("replaces placeholders, escapes delimiters, and supports primitives", async () => {
    const { renderPromptTemplate } = await import(modulePath);
    const long = "x".repeat(10000);

    const result = renderPromptTemplate("Hello {{Name}} {{AGE}} {{flag}} {{text}}", {
      vars: new Map([
        ["name", "Alice {{inject}}"],
        ["age", 42],
        ["flag", false],
        ["text", long],
      ]),
    });

    expect(result).toContain("Hello");
    expect(result).toContain("42");
    expect(result).toContain("false");
    expect(result).toContain(long);
    expect(result).toContain("{{inject}}");
  });

  it("flattens nested vars, respects depth limits, and can drop unresolved", async () => {
    const { renderPromptTemplate } = await import(modulePath);
    const vars = {
      a: {
        b: "value",
        deep: { c: { d: { e: "tooDeep" } } },
      },
    };

    const output = renderPromptTemplate("{{a.b}}|{{a.deep.c.d.e}}|{{missing}}", {
      vars,
      keepUnresolved: false,
    });

    expect(output).toBe("value||");
  });

  it("appends extra content when placeholders are missing", async () => {
    const { renderPromptTemplate } = await import(modulePath);

    const output = renderPromptTemplate("Hello {{name}}", {
      vars: { name: "Ada" },
      appendIfMissing: { footer: "Footer", name: "Ignore" },
    });

    expect(output).toBe("Hello Ada\n\nFooter");
  });

  it("warns on unresolved placeholders when configured", async () => {
    const { renderPromptTemplate } = await import(modulePath);

    const output = renderPromptTemplate("Hi {{missing}}", { warnOnUnresolved: true });

    expect(output).toBe("Hi {{missing}}");
    const warnCalls = createdLoggers.flatMap(({ logger }) => logger.warn.mock.calls);
    expect(warnCalls.some(([msg]) => String(msg).includes("missing"))).toBe(true);
  });

  it("calls onUnresolved and throws when failOnUnresolved is set", async () => {
    const { renderPromptTemplate } = await import(modulePath);
    const onUnresolved = vi.fn();

    expect(() =>
      renderPromptTemplate("{{missing}}", { failOnUnresolved: true, onUnresolved })
    ).toThrow(/Unresolved placeholders/);

    expect(onUnresolved).toHaveBeenCalledWith(["missing"]);
  });

  it("handles empty and null inputs", async () => {
    const { renderPromptTemplate } = await import(modulePath);

    expect(renderPromptTemplate(null)).toBe("");
    expect(renderPromptTemplate(undefined, { vars: {} })).toBe("");
    expect(renderPromptTemplate("", { vars: [] })).toBe("");
    expect(renderPromptTemplate("{{x}}", { vars: {} })).toBe("{{x}}");
  });
});

describe("default export", () => {
  it("exposes named exports", async () => {
    const mod = await import(modulePath);

    expect(mod.default.loadPrompt).toBe(mod.loadPrompt);
    expect(mod.default.loadPromptSync).toBe(mod.loadPromptSync);
    expect(mod.default.preloadPrompts).toBe(mod.preloadPrompts);
    expect(mod.default.clearPromptCache).toBe(mod.clearPromptCache);
    expect(mod.default.getCachedPromptNames).toBe(mod.getCachedPromptNames);
    expect(mod.default.configurePromptCache).toBe(mod.configurePromptCache);
    expect(mod.default.renderPromptTemplate).toBe(mod.renderPromptTemplate);
  });
});
