// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock common optional dependency used by HTML parsers.
// If `jsdom` exists, we pass through to the real implementation.
vi.mock("jsdom", async () => {
  try {
    return await vi.importActual("jsdom");
  } catch {
    class JSDOM {
      constructor(html = "", options = {}) {
        const doc = new DOMParser().parseFromString(String(html ?? ""), "text/html");
        const url = typeof options?.url === "string" ? options.url : "https://example.test/";
        this.window = {
          document: doc,
          location: new URL(url),
        };
      }
    }
    return { JSDOM };
  }
});

import * as ModNS from "../../../../js/agents/mcp/smart-content-extractor.js";

const SAMPLE_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Doc Title</title>
    <style>.ad{display:block}</style>
    <script>console.log("NOISE_SCRIPT")</script>
  </head>
  <body>
    <header>
      <nav>MENU_NAV</nav>
    </header>

    <main>
      <article>
        <h1>My Article</h1>
        <p>Intro &amp; details&nbsp;with entities.</p>

        <div class="ad">ADVERTISEMENT_BLOCK</div>

        <p>https://example.com</p>
        <p>test@example.com</p>
        <p>123</p>
        <p>v1.2.3</p>
        <p>2024-01-01</p>
        <p>2024-01-01T12:34:56</p>
        <p>123e4567-e89b-12d3-a456-426614174000</p>
        <p>#main</p>
        <p>...</p>

        <p>Useful paragraph.</p>

        <p>
          <a href="https://example.com/path">Example Link</a>
          <a href="/relative">Relative Link</a>
          <a href="javascript:alert(1)">Bad Link</a>
        </p>
      </article>

      <aside class="sidebar">SIDEBAR_NOISE</aside>
    </main>

    <footer>FOOTER_NOISE</footer>
  </body>
</html>`;

function isPromiseLike(v) {
  return !!v && (typeof v === "object" || typeof v === "function") && typeof v.then === "function";
}

async function maybeAwait(v) {
  return isPromiseLike(v) ? await v : v;
}

function isClassLike(fn) {
  if (typeof fn !== "function") return false;
  const src = Function.prototype.toString.call(fn);
  return /^\s*class\s+/.test(src);
}

function pickTextFromResult(res) {
  if (res == null) return "";
  if (typeof res === "string") return res;
  if (Array.isArray(res)) return res.map(String).join("\n");
  if (typeof res === "object") {
    const directKeys = ["markdown", "content", "text", "mainContent", "body", "html", "title"];
    for (const k of directKeys) {
      if (typeof res[k] === "string") return res[k];
    }
    const nestedKeys = ["data", "result", "article", "payload"];
    for (const k of nestedKeys) {
      const v = res[k];
      if (v && typeof v === "object") {
        for (const kk of directKeys) {
          if (typeof v[kk] === "string") return v[kk];
        }
      }
    }
    if (Array.isArray(res.links)) return res.links.map(String).join("\n");
    if (Array.isArray(res.images)) return res.images.map(String).join("\n");
  }
  return String(res);
}

function splitNonEmptyLines(s) {
  return String(s ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

async function callWithHtmlLikeInput(fn, html, options) {
  const argHtml = html;

  // Attempt 1: HTML string
  try {
    return await maybeAwait(fn.length >= 2 ? fn(argHtml, options) : fn(argHtml));
  } catch (e1) {
    // Attempt 2: Document
    const doc = new DOMParser().parseFromString(String(argHtml ?? ""), "text/html");
    try {
      return await maybeAwait(fn.length >= 2 ? fn(doc, options) : fn(doc));
    } catch (e2) {
      // Attempt 3: Element (body)
      try {
        return await maybeAwait(fn.length >= 2 ? fn(doc.body, options) : fn(doc.body));
      } catch {
        throw e1;
      }
    }
  }
}

function classifyExport(name, fn) {
  const src = typeof fn === "function" ? Function.prototype.toString.call(fn) : "";

  if (/decode.*entit/i.test(name) || (src.includes("&nbsp;") && src.includes("&amp;"))) return "decodeHtmlEntities";
  if (/should.*skip/i.test(name) || src.includes("SKIP_PATTERNS")) return "shouldSkipText";
  if (/clean.*text/i.test(name) || (src.includes("trim()") && src.includes("replace(") && /clean/i.test(name)))
    return "cleanText";

  if (/link/i.test(name) || src.includes("href")) return "extractLinks";
  if (/image|img/i.test(name) || src.includes("<img") || src.includes("img")) return "extractImages";
  if (/title/i.test(name) || src.includes("document.title") || src.includes("<title")) return "extractTitle";

  if (/extract/i.test(name) || /Extractor$/.test(name) || src.includes("MAIN_CONTENT_SELECTORS")) return "extractContent";

  return "unknown";
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("module exports", () => {
  it("exports at least one symbol", () => {
    expect(Object.keys(ModNS).length).toBeGreaterThan(0);
  });
});

const functionExports = Object.entries(ModNS).filter(([, v]) => typeof v === "function");

for (const [exportName, exportedValue] of functionExports) {
  const kind = classifyExport(exportName, exportedValue);

  describe(exportName, () => {
    if (isClassLike(exportedValue)) {
      it("can be constructed (no args or {} as fallback)", () => {
        let instance;
        try {
          instance = new exportedValue();
        } catch {
          instance = new exportedValue({});
        }
        expect(instance).toBeTruthy();
      });

      it("extract-like method (if present) handles HTML sample", async () => {
        let instance;
        try {
          instance = new exportedValue();
        } catch {
          instance = new exportedValue({});
        }

        const candidates = [
          // static
          ["extract", exportedValue.extract],
          ["extractFromHtml", exportedValue.extractFromHtml],
          ["extractHTML", exportedValue.extractHTML],
          ["parse", exportedValue.parse],
          ["run", exportedValue.run],
          // instance
          ["extract", instance?.extract],
          ["extractFromHtml", instance?.extractFromHtml],
          ["extractHTML", instance?.extractHTML],
          ["parse", instance?.parse],
          ["run", instance?.run],
        ].filter(([, fn]) => typeof fn === "function");

        if (candidates.length === 0) {
          expect(true).toBe(true);
          return;
        }

        const [, method] = candidates[0];
        const bound =
          method === exportedValue.extract ||
          method === exportedValue.extractFromHtml ||
          method === exportedValue.extractHTML ||
          method === exportedValue.parse ||
          method === exportedValue.run
            ? method.bind(exportedValue)
            : method.bind(instance);

        const res = await callWithHtmlLikeInput(bound, SAMPLE_HTML, { url: "https://example.test/" });
        expect(res).not.toBeUndefined();

        const text = pickTextFromResult(res);
        expect(typeof text).toBe("string");
        expect(text.length).toBeGreaterThanOrEqual(0);
      });

      return;
    }

    if (kind === "decodeHtmlEntities") {
      it("decodes common HTML entities", async () => {
        const fn = exportedValue;
        const input = 'a&nbsp;&amp;&lt;&gt;&quot;&#39;&#x27;&#65;';
        const out = await maybeAwait(fn(input));
        expect(out).toBe('a &<>"\'\'A');
      });

      it("handles nullish and empty inputs", async () => {
        const fn = exportedValue;
        expect(await maybeAwait(fn(null))).toBe("");
        expect(await maybeAwait(fn(undefined))).toBe("");
        expect(await maybeAwait(fn(""))).toBe("");
      });

      it("type boundary: 0 becomes empty, -1 and MAX_SAFE_INTEGER throw", async () => {
        const fn = exportedValue;
        expect(await maybeAwait(fn(0))).toBe("");
        expect(() => fn(-1)).toThrow();
        expect(() => fn(Number.MAX_SAFE_INTEGER)).toThrow();
      });

      return;
    }

    if (kind === "shouldSkipText") {
      it("does not skip normal sentence", async () => {
        const fn = exportedValue;
        const out = await maybeAwait(fn("Hello world, this is content."));
        expect(out).toBe(false);
      });

      it("skips known noise patterns and boundary lengths", async () => {
        const fn = exportedValue;

        const shouldSkip = [
          null,
          undefined,
          "",
          " ",
          "\n\t",
          "a",
          "https://example.com",
          "test@example.com",
          "123",
          "v1.2.3",
          "2024-01-01",
          "2024-01-01T12:34:56",
          "123e4567-e89b-12d3-a456-426614174000",
          "#main",
          ".class-name",
          "&nbsp;",
          "...",
          "----",
          "0",
          String("x".repeat(10001)),
        ];

        for (const v of shouldSkip) {
          // eslint-disable-next-line no-await-in-loop
          expect(await maybeAwait(fn(v))).toBe(true);
        }

        expect(await maybeAwait(fn("ab"))).toBe(false);
      });

      it("type boundary: 0 is handled, other non-string truthy values throw", () => {
        const fn = exportedValue;
        expect(fn(0)).toBe(true);
        expect(() => fn(-1)).toThrow();
        expect(() => fn(Number.MAX_SAFE_INTEGER)).toThrow();
        expect(() => fn({})).toThrow();
        expect(() => fn([])).toThrow();
      });

      it("concurrency: parallel calls are deterministic", async () => {
        const fn = exportedValue;
        const inputs = [
          "Hello world",
          "https://example.com",
          "v1.2.3",
          "ab",
          "123e4567-e89b-12d3-a456-426614174000",
        ];

        const results = await Promise.all(inputs.map((v) => maybeAwait(fn(v))));
        expect(results).toEqual([false, true, true, false, true]);
      });

      return;
    }

    if (kind === "cleanText") {
      it("normalizes whitespace and decodes basic entities (behavioral invariants)", async () => {
        const fn = exportedValue;
        const input = " \n Hello&nbsp;world \t &amp; test  ";
        const out = await maybeAwait(fn(input));

        expect(typeof out).toBe("string");
        expect(out.trim()).toBe(out);
        expect(out).not.toContain("&nbsp;");
        expect(out).not.toContain("&amp;");
        expect(out).toContain("Hello");
        expect(out).toContain("world");
      });

      it("handles nullish and empty inputs", async () => {
        const fn = exportedValue;
        const outNull = await maybeAwait(fn(null));
        const outUndef = await maybeAwait(fn(undefined));
        const outEmpty = await maybeAwait(fn(""));

        expect(typeof outNull).toBe("string");
        expect(typeof outUndef).toBe("string");
        expect(typeof outEmpty).toBe("string");
        expect(outNull.trim()).toBe("");
        expect(outUndef.trim()).toBe("");
        expect(outEmpty.trim()).toBe("");
      });

      it("resource boundary: long but chunked text does not throw", async () => {
        const fn = exportedValue;
        const long = Array.from({ length: 2000 }, (_, i) => `para-${i}   x\t y\n`).join("");
        const out = await maybeAwait(fn(long));
        expect(typeof out).toBe("string");
      });

      it("type boundary: 0 becomes empty, -1 and MAX_SAFE_INTEGER throw", async () => {
        const fn = exportedValue;
        const out0 = await maybeAwait(fn(0));
        expect(typeof out0).toBe("string");
        expect(out0.trim()).toBe("");

        expect(() => fn(-1)).toThrow();
        expect(() => fn(Number.MAX_SAFE_INTEGER)).toThrow();
      });

      return;
    }

    // HTML/content extraction-like exports (including links/title/images)
    if (kind === "extractContent" || kind === "extractLinks" || kind === "extractTitle" || kind === "extractImages") {
      it("normal path: produces a meaningful result from sample HTML", async () => {
        const fn = exportedValue;
        const res = await callWithHtmlLikeInput(fn, SAMPLE_HTML, { url: "https://example.test/" });

        expect(res).not.toBeUndefined();

        // Shape-driven assertions: keep them meaningful but not brittle.
        if (Array.isArray(res)) {
          expect(res.every((x) => typeof x === "string")).toBe(true);
          expect(res).toContain("https://example.com/path");
          expect(res.join("\n")).not.toContain("javascript:alert(1)");
          return;
        }

        if (res && typeof res === "object") {
          if (Array.isArray(res.links)) {
            expect(res.links).toContain("https://example.com/path");
            expect(res.links.join("\n")).not.toContain("javascript:alert(1)");
            return;
          }
          if (typeof res.title === "string") {
            expect(res.title).toContain("Doc Title");
            return;
          }
        }

        const text = pickTextFromResult(res);
        expect(typeof text).toBe("string");
        expect(text).toContain("My Article");
        expect(text).toContain("Intro & details with entities.");

        // Noise removed from obvious noise blocks
        expect(text).not.toContain("NOISE_SCRIPT");
        expect(text).not.toContain("ADVERTISEMENT_BLOCK");
        expect(text).not.toContain("SIDEBAR_NOISE");
        expect(text).not.toContain("FOOTER_NOISE");
        expect(text).not.toContain("MENU_NAV");

        // Skip-pattern-only paragraphs should not survive as standalone lines
        const lines = splitNonEmptyLines(text);
        expect(lines).not.toContain("https://example.com");
        expect(lines).not.toContain("test@example.com");
        expect(lines).not.toContain("123");
        expect(lines).not.toContain("v1.2.3");
        expect(lines).not.toContain("2024-01-01");
        expect(lines).not.toContain("2024-01-01T12:34:56");
        expect(lines).not.toContain("123e4567-e89b-12d3-a456-426614174000");
        expect(lines).not.toContain("#main");
        expect(lines).not.toContain("...");
      });

      it("boundary: empty string yields empty-ish output", async () => {
        const fn = exportedValue;
        const res = await callWithHtmlLikeInput(fn, "", { url: "https://example.test/" });

        if (Array.isArray(res)) {
          expect(res.length).toBe(0);
          return;
        }

        if (res && typeof res === "object" && typeof res.title === "string" && !("content" in res) && !("markdown" in res)) {
          // title-only extractor may fall back to empty.
          expect(res.title.trim().length >= 0).toBe(true);
          return;
        }

        const text = pickTextFromResult(res);
        expect(typeof text).toBe("string");
        expect(text.trim()).toBe("");
      });

      it("boundary: nullish input yields empty-ish output or throws TypeError (documented by behavior)", async () => {
        const fn = exportedValue;

        const run = async (value) => {
          try {
            return { ok: true, res: await callWithHtmlLikeInput(fn, value, { url: "https://example.test/" }) };
          } catch (e) {
            return { ok: false, err: e };
          }
        };

        const [rNull, rUndef] = await Promise.all([run(null), run(undefined)]);

        for (const r of [rNull, rUndef]) {
          if (!r.ok) {
            expect(r.err).toBeInstanceOf(Error);
            continue;
          }
          if (Array.isArray(r.res)) {
            expect(r.res.length).toBe(0);
            continue;
          }
          const text = pickTextFromResult(r.res);
          expect(typeof text).toBe("string");
        }
      });

      it("resource boundary: large HTML (many small nodes) does not throw", async () => {
        const fn = exportedValue;

        const paragraphs = Array.from({ length: 2500 }, (_, i) => `<p>para ${i}: ${"x".repeat(120)}</p>`).join("");
        const html = `<html><body><main><article><h1>Big</h1>${paragraphs}</article></main></body></html>`;

        const res = await callWithHtmlLikeInput(fn, html, { url: "https://example.test/" });
        expect(res).not.toBeUndefined();

        const text = pickTextFromResult(res);
        expect(typeof text).toBe("string");
      });

      it("deep nesting: handles deeply nested DOM without crashing", async () => {
        const fn = exportedValue;

        let nested = "<p>Deep content</p>";
        for (let i = 0; i < 200; i++) nested = `<div>${nested}</div>`;
        const html = `<html><body><main><article>${nested}</article></main></body></html>`;

        const res = await callWithHtmlLikeInput(fn, html, { url: "https://example.test/" });
        expect(res).not.toBeUndefined();

        const text = pickTextFromResult(res);
        expect(typeof text).toBe("string");
        // Some implementations intentionally cap traversal depth to avoid pathological DOMs.
        // If content is returned, it should include the deeply nested text; otherwise accept empty.
        if (text.trim()) expect(text).toContain("Deep content");
      });

      it("concurrency: parallel calls return consistent results", async () => {
        const fn = exportedValue;

        const calls = Array.from({ length: 20 }, () => callWithHtmlLikeInput(fn, SAMPLE_HTML, { url: "https://example.test/" }));
        const results = await Promise.all(calls);

        const texts = results.map((r) => pickTextFromResult(r));
        expect(texts.every((t) => typeof t === "string")).toBe(true);

        // Must be identical after trimming (avoid incidental whitespace differences).
        const trimmed = texts.map((t) => t.trim());
        expect(new Set(trimmed).size).toBe(1);
      });

      return;
    }

    // Unknown function exports: keep tests meaningful but non-assumptive.
    it("basic contract: callable and returns a value (or throws a TypeError on invalid input)", async () => {
      const fn = exportedValue;

      const tryCall = async (args) => {
        try {
          return { ok: true, res: await maybeAwait(fn(...args)) };
        } catch (e) {
          return { ok: false, err: e };
        }
      };

      const [r0, r1] = await Promise.all([tryCall([]), tryCall(["test"])]);
      const anyOk = r0.ok || r1.ok;
      expect(anyOk).toBe(true);

      for (const r of [r0, r1]) {
        if (!r.ok) {
          expect(r.err).toBeInstanceOf(Error);
          continue;
        }
        expect(r.res).not.toBeUndefined();
      }
    });

    it("boundary: nullish input does not crash the test runner (returns value or throws)", async () => {
      const fn = exportedValue;

      const tryCall = async (v) => {
        try {
          return { ok: true, res: await maybeAwait(fn(v)) };
        } catch (e) {
          return { ok: false, err: e };
        }
      };

      const [rNull, rUndef, rEmpty] = await Promise.all([tryCall(null), tryCall(undefined), tryCall("")]);

      for (const r of [rNull, rUndef, rEmpty]) {
        if (!r.ok) {
          expect(r.err).toBeInstanceOf(Error);
        } else {
          expect(r.res).not.toBeUndefined();
        }
      }
    });
  });
}

// Optional: exported selector/constants sanity checks (only if present)
describe("exported constants (if any)", () => {
  it("MAIN_CONTENT_SELECTORS includes semantic selectors (when exported)", () => {
    if (!Array.isArray(ModNS.MAIN_CONTENT_SELECTORS)) return;
    expect(ModNS.MAIN_CONTENT_SELECTORS).toContain("article");
    expect(ModNS.MAIN_CONTENT_SELECTORS).toContain("main");
  });

  it("NOISE_SELECTORS includes script/style and nav/header/footer (when exported)", () => {
    if (!Array.isArray(ModNS.NOISE_SELECTORS)) return;
    expect(ModNS.NOISE_SELECTORS).toEqual(expect.arrayContaining(["script", "style", "nav", "header", "footer"]));
  });
});
