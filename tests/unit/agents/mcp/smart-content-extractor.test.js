import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "virtual:domparser",
  () => ({
    ThrowingDOMParser: class ThrowingDOMParser {
      parseFromString() {
        throw new Error("parse failed");
      }
    },
  }),
  { virtual: true },
);

import { DOMParser as LinkeDOMParser } from "linkedom";
import extractSmartContentDefault, {
  extractSmartContent,
  htmlToMarkdown,
  htmlToPlainText,
} from "../../../../js/agents/mcp/smart-content-extractor.js";
import { ThrowingDOMParser } from "virtual:domparser";

const TRUNCATION_NOTICE = "...(\u5185\u5bb9\u5df2\u622a\u65ad)";
const LONG_TEXT = "content ".repeat(80);

function makeHtml({
  title = "Doc Title",
  description = "Doc Desc",
  author = "Author A",
  publishDate = "2024-01-02",
  body = "",
} = {}) {
  return [
    "<!doctype html>",
    "<html><head>",
    `<title>${title}</title>`,
    `<meta name="description" content="${description}">`,
    `<meta name="author" content="${author}">`,
    `<meta property="article:published_time" content="${publishDate}">`,
    "</head><body>",
    body,
    "</body></html>",
  ].join("");
}

function buildSampleHtml() {
  const body = [
    "<header>Header noise</header>",
    "<nav>Nav noise</nav>",
    "<main>",
    '<article class="post-content">',
    "<h1>Article Heading</h1>",
    `<p>${LONG_TEXT} <strong>bold</strong> <a href="https://example.com">Example Link</a></p>`,
    '<p>Second paragraph with <code>inline</code> code.</p>',
    "<ul>",
    '<li>Item <a href="https://example.com/one">One Link</a></li>',
    "<li>Item <em>Two</em></li>",
    "</ul>",
    '<pre><code class="language-js">const x = 1;</code></pre>',
    '<img src="https://example.com/img.png" alt="Alt text">',
    '<div class="comment">Comment should be removed</div>',
    "</article>",
    "</main>",
    "<footer>Footer noise</footer>",
  ].join("");

  return makeHtml({ body });
}

function makeNestedHtml(depth, text) {
  let open = "";
  let close = "";
  for (let i = 0; i < depth; i += 1) {
    open += "<div>";
    close = `</div>${close}`;
  }
  return `${open}<p>${text}</p>${close}`;
}

async function withDomParser(DOMParserImpl, fn) {
  const hadDomParser = Object.prototype.hasOwnProperty.call(globalThis, "DOMParser");
  const previous = globalThis.DOMParser;

  if (DOMParserImpl === undefined) {
    delete globalThis.DOMParser;
  } else {
    globalThis.DOMParser = DOMParserImpl;
  }

  try {
    return await fn();
  } finally {
    if (!hadDomParser) {
      delete globalThis.DOMParser;
    } else {
      globalThis.DOMParser = previous;
    }
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("extractSmartContent", () => {
  it("returns defaults for empty or invalid inputs", () => {
    const inputs = [null, undefined, "", [], {}];

    for (const input of inputs) {
      const result = extractSmartContent(input);
      expect(result).toEqual({
        markdown: "",
        plainText: "",
        metadata: {
          title: "",
          description: "",
          author: "",
          publishDate: "",
          wordCount: 0,
          headings: [],
          links: [],
          images: [],
        },
        structure: {
          mainContentSelector: null,
          removedElements: 0,
          extractedSections: 0,
        },
      });
    }
  });

  it("falls back to plain text when DOMParser is unavailable", async () => {
    await withDomParser(undefined, () => {
      const html = "<div>Hello &amp; <span>world</span></div><script>bad()</script>";
      const result = extractSmartContent(html);

      expect(result.structure.mainContentSelector).toBe("fallback(no-dom)");
      expect(result.markdown).toBe("Hello & world");
      expect(result.plainText).toBe("Hello & world");
      expect(result.metadata.wordCount).toBe(result.plainText.length);
    });
  });

  it("extracts metadata, markdown, and structure when DOMParser is available", async () => {
    await withDomParser(LinkeDOMParser, () => {
      const html = buildSampleHtml();
      const result = extractSmartContent(html, { maxLength: 20000 });

      expect(result.metadata.title).toBe("Doc Title");
      expect(result.metadata.description).toBe("Doc Desc");
      expect(result.metadata.author).toBe("Author A");
      expect(result.metadata.publishDate).toBe("2024-01-02");
      expect(result.metadata.headings).toEqual(
        expect.arrayContaining([{ level: 1, text: "Article Heading" }]),
      );
      expect(result.metadata.links).toEqual(
        expect.arrayContaining([
          { text: "Example Link", url: "https://example.com" },
          { text: "One Link", url: "https://example.com/one" },
        ]),
      );
      expect(result.metadata.images).toEqual(
        expect.arrayContaining([{ alt: "Alt text", src: "https://example.com/img.png" }]),
      );
      expect(result.structure.mainContentSelector).toBe("article");
      expect(result.structure.removedElements).toBeGreaterThan(0);
      expect(result.structure.extractedSections).toBe(1);

      expect(result.markdown).toContain("# Article Heading");
      expect(result.markdown).toContain("```js");
      expect(result.markdown).toContain("const x = 1;");
      expect(result.markdown).toContain("Example Link");
      expect(result.markdown).toMatch(/- Item \[One Link\]\(https:\/\/example\.com\/one\)/);
      expect(result.markdown).not.toContain("Comment should be removed");

      expect(result.plainText).toContain("Article Heading");
      expect(result.plainText).toContain("Second paragraph with");
      expect(result.plainText).toContain("inline");
      expect(result.plainText).toContain("code.");
      expect(result.plainText).not.toContain("Comment should be removed");
      expect(result.plainText).not.toContain("const x = 1;");
      expect(result.metadata.wordCount).toBe(result.plainText.length);
    });
  });

  it("omits metadata links when preserveLinks is false", async () => {
    await withDomParser(LinkeDOMParser, () => {
      const html = buildSampleHtml();
      const result = extractSmartContent(html, { preserveLinks: false });

      expect(result.metadata.links).toEqual([]);
      expect(result.metadata.images.length).toBeGreaterThan(0);
    });
  });

  it("handles whitespace-only html and array options", async () => {
    await withDomParser(undefined, () => {
      const result = extractSmartContent("   ", []);
      expect(result.markdown).toBe("");
      expect(result.plainText).toBe("");
      expect(result.structure.mainContentSelector).toBe("fallback(no-dom)");
    });
  });

  it("truncates markdown for maxLength boundaries and numeric strings", async () => {
    await withDomParser(LinkeDOMParser, () => {
      const html = buildSampleHtml();
      const results = [
        extractSmartContent(html, { maxLength: 0 }),
        extractSmartContent(html, { maxLength: -1 }),
        extractSmartContent(html, { maxLength: "40" }),
      ];

      for (const result of results) {
        expect(result.markdown).toContain(TRUNCATION_NOTICE);
        expect(result.markdown.length).toBeGreaterThan(0);
      }
    });
  });

  it("does not truncate when maxLength is MAX_SAFE_INTEGER", async () => {
    await withDomParser(LinkeDOMParser, () => {
      const html = buildSampleHtml();
      const result = extractSmartContent(html, { maxLength: Number.MAX_SAFE_INTEGER });

      expect(result.markdown).not.toContain(TRUNCATION_NOTICE);
      expect(result.markdown).toContain("# Article Heading");
    });
  });

  it("falls back when DOMParser throws and fallbackOnError is true", async () => {
    await withDomParser(ThrowingDOMParser, () => {
      const html = "<div>Hello <span>world</span></div>";
      const result = extractSmartContent(html);

      expect(result.structure.mainContentSelector).toBe("fallback");
      expect(result.markdown).toBe("Hello world");
      expect(result.plainText).toBe("Hello world");
    });
  });

  it("throws when DOMParser throws and fallbackOnError is false", async () => {
    await withDomParser(ThrowingDOMParser, () => {
      const html = "<div>Hello <span>world</span></div>";
      expect(() => extractSmartContent(html, { fallbackOnError: false })).toThrow(/parse failed/);
    });
  });

  it("handles concurrent and rapid sequential calls without shared state", async () => {
    await withDomParser(LinkeDOMParser, async () => {
      const htmlA = makeHtml({
        title: "Doc A",
        body: `<article class="post-content"><h1>A</h1><p>${"alpha ".repeat(80)}</p></article>`,
      });
      const htmlB = makeHtml({
        title: "Doc B",
        body: `<article class="post-content"><h1>B</h1><p>${"beta ".repeat(80)}</p></article>`,
      });

      const [a, b] = await Promise.all([
        Promise.resolve().then(() => extractSmartContent(htmlA)),
        Promise.resolve().then(() => extractSmartContent(htmlB)),
      ]);

      expect(a.metadata.title).toBe("Doc A");
      expect(b.metadata.title).toBe("Doc B");

      const rapidResults = Array.from({ length: 20 }, () => extractSmartContent(htmlA));
      for (const result of rapidResults) {
        expect(result.metadata.title).toBe("Doc A");
      }
    });
  });

  it("handles large inputs and deep nesting without crashing", async () => {
    await withDomParser(undefined, () => {
      const hugeText = "x".repeat(60000);
      const html = `<div>${hugeText}</div>`;
      const result = extractSmartContent(html);

      expect(result.markdown.length).toBe(50000);
      expect(result.plainText.length).toBe(50000);
    });

    await withDomParser(LinkeDOMParser, () => {
      const shallowText = "shallow ".repeat(80);
      const nested = makeNestedHtml(60, "Deep Text");
      const html = makeHtml({
        body: `<article class="post-content"><p>${shallowText}</p>${nested}</article>`,
      });
      const result = extractSmartContent(html);

      expect(result.markdown).toContain("shallow");
      expect(result.markdown).not.toContain("Deep Text");
    });
  });
});

describe("htmlToMarkdown", () => {
  it("returns markdown for normal HTML input", async () => {
    await withDomParser(LinkeDOMParser, () => {
      const html = buildSampleHtml();
      const markdown = htmlToMarkdown(html);

      expect(markdown).toContain("# Article Heading");
      expect(markdown).toContain("```js");
      expect(markdown).toContain("const x = 1;");
    });
  });

  it("returns empty string for whitespace input", async () => {
    await withDomParser(undefined, () => {
      expect(htmlToMarkdown("   ")).toBe("");
    });
  });

  it("throws when DOMParser fails and fallbackOnError is false", async () => {
    await withDomParser(ThrowingDOMParser, () => {
      expect(() => htmlToMarkdown("<div>bad</div>", { fallbackOnError: false })).toThrow(/parse failed/);
    });
  });
});

describe("htmlToPlainText", () => {
  it("returns cleaned plain text for normal HTML input", async () => {
    await withDomParser(LinkeDOMParser, () => {
      const html = buildSampleHtml();
      const plainText = htmlToPlainText(html);

      expect(plainText).toContain("Article Heading");
      expect(plainText).toContain("Example Link");
      expect(plainText).not.toContain("```");
      expect(plainText).not.toContain("[");
      expect(plainText).not.toContain("]");
      expect(plainText).not.toContain("const x = 1;");
    });
  });

  it("returns empty string for object input", () => {
    expect(htmlToPlainText({})).toBe("");
  });

  it("throws when DOMParser fails and fallbackOnError is false", async () => {
    await withDomParser(ThrowingDOMParser, () => {
      expect(() => htmlToPlainText("<div>bad</div>", { fallbackOnError: false })).toThrow(/parse failed/);
    });
  });
});

describe("default export", () => {
  it("matches the named extractSmartContent export", async () => {
    await withDomParser(LinkeDOMParser, () => {
      const html = buildSampleHtml();
      const named = extractSmartContent(html);
      const defaultResult = extractSmartContentDefault(html);

      expect(extractSmartContentDefault).toBe(extractSmartContent);
      expect(defaultResult.markdown).toBe(named.markdown);
      expect(defaultResult.plainText).toBe(named.plainText);
    });
  });

  it("returns defaults for null input", () => {
    const result = extractSmartContentDefault(null);
    expect(result.markdown).toBe("");
    expect(result.plainText).toBe("");
    expect(result.structure.mainContentSelector).toBe(null);
  });

  it("throws when DOMParser fails and fallbackOnError is false", async () => {
    await withDomParser(ThrowingDOMParser, () => {
      expect(() => extractSmartContentDefault("<div>bad</div>", { fallbackOnError: false })).toThrow(/parse failed/);
    });
  });
});
