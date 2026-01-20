import { describe, it, expect, vi, beforeEach } from "vitest";

const designUtilsMocks = vi.hoisted(() => ({
  isPlainObject: vi.fn(),
  toNonEmptyString: vi.fn(),
  parseSections: vi.fn(),
  clearParseCache: vi.fn(),
  joinSections: vi.fn(),
  extractElements: vi.fn(),
}));

vi.mock("../../../../../../js/agents/stages/design/shared/design-utils.js", () => ({
  isPlainObject: designUtilsMocks.isPlainObject,
  toNonEmptyString: designUtilsMocks.toNonEmptyString,
  parseSections: designUtilsMocks.parseSections,
  clearParseCache: designUtilsMocks.clearParseCache,
  joinSections: designUtilsMocks.joinSections,
  extractElements: designUtilsMocks.extractElements,
}));

const SPLIT = "<!--SPLIT-->";

function defaultParseSections(deckHtmlDsl) {
  if (typeof deckHtmlDsl !== "string") return [];
  const trimmed = deckHtmlDsl.trim();
  if (!trimmed) return [];
  return trimmed
    .split(SPLIT)
    .map((value) => value.trim())
    .filter(Boolean);
}

function defaultJoinSections(sections) {
  if (!Array.isArray(sections)) return "";
  return sections.join(SPLIT);
}

function defaultExtractElements(sectionHtml) {
  if (typeof sectionHtml !== "string") return [];
  const matches = [...sectionHtml.matchAll(/data-el="([^"]+)"/g)];
  return matches.map((match) => ({
    elementId: match[1],
    tag: "div",
    attrs: { "data-el": match[1] },
  }));
}

function resetDesignUtilsMocks() {
  designUtilsMocks.isPlainObject.mockReset();
  designUtilsMocks.toNonEmptyString.mockReset();
  designUtilsMocks.parseSections.mockReset();
  designUtilsMocks.clearParseCache.mockReset();
  designUtilsMocks.joinSections.mockReset();
  designUtilsMocks.extractElements.mockReset();

  designUtilsMocks.isPlainObject.mockImplementation((value) => {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });
  designUtilsMocks.toNonEmptyString.mockImplementation((value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  });
  designUtilsMocks.parseSections.mockImplementation(defaultParseSections);
  designUtilsMocks.joinSections.mockImplementation(defaultJoinSections);
  designUtilsMocks.extractElements.mockImplementation(defaultExtractElements);
  designUtilsMocks.clearParseCache.mockImplementation(() => undefined);
}

async function loadToolsModule() {
  return await import("../../../../../../js/agents/stages/design/refiner/react-refiner-tools.js");
}

describe("parseSections", () => {
  let parseSections;

  beforeEach(async () => {
    vi.resetModules();
    resetDesignUtilsMocks();
    ({ parseSections } = await loadToolsModule());
  });

  it("delegates to design-utils for normal input", () => {
    const input = "<section>A</section><!--SPLIT--><section>B</section>";
    designUtilsMocks.parseSections.mockImplementation((value) => value.split(SPLIT));

    const result = parseSections(input);

    expect(result).toEqual(["<section>A</section>", "<section>B</section>"]);
    expect(designUtilsMocks.parseSections).toHaveBeenCalledWith(input);
  });

  it("forwards empty or blank inputs", () => {
    const inputs = [null, undefined, "", "   "];
    designUtilsMocks.parseSections.mockImplementation((value) => [String(value)]);

    const results = inputs.map((value) => parseSections(value));

    expect(results).toEqual(inputs.map((value) => [String(value)]));
    expect(designUtilsMocks.parseSections.mock.calls.map((call) => call[0])).toEqual(inputs);
  });

  it("handles numeric boundaries and numeric strings", () => {
    const inputs = [0, -1, Number.MAX_SAFE_INTEGER, "42"];
    designUtilsMocks.parseSections.mockImplementation((value) => [String(value)]);

    const results = inputs.map((value) => parseSections(value));

    expect(results).toEqual(inputs.map((value) => [String(value)]));
    expect(designUtilsMocks.parseSections.mock.calls.map((call) => call[0])).toEqual(inputs);
  });

  it("supports concurrent calls and large inputs", async () => {
    const huge = "x".repeat(200000);
    const inputs = [huge, "alpha", "beta"];
    designUtilsMocks.parseSections.mockImplementation((value) => [String(value).length]);

    const results = await Promise.all(inputs.map((value) => Promise.resolve(parseSections(value))));

    expect(results).toEqual(inputs.map((value) => [String(value).length]));
    expect(designUtilsMocks.parseSections).toHaveBeenCalledTimes(inputs.length);
  });

  it("surfaces errors from design-utils", () => {
    const err = new Error("parse failed");
    designUtilsMocks.parseSections.mockImplementation(() => {
      throw err;
    });

    expect(() => parseSections("<section/>")).toThrow(err);
  });
});

describe("joinSections", () => {
  let joinSections;

  beforeEach(async () => {
    vi.resetModules();
    resetDesignUtilsMocks();
    ({ joinSections } = await loadToolsModule());
  });

  it("delegates to design-utils for normal input", () => {
    const sections = ["<section>A</section>", "<section>B</section>"];
    designUtilsMocks.joinSections.mockImplementation((value) => value.join("\n\n"));

    const result = joinSections(sections);

    expect(result).toBe("<section>A</section>\n\n<section>B</section>");
    expect(designUtilsMocks.joinSections).toHaveBeenCalledWith(sections);
  });

  it("handles empty arrays and object-as-array input", () => {
    designUtilsMocks.joinSections.mockImplementation((value) => (Array.isArray(value) ? value.join("|") : "not-array"));

    const emptyResult = joinSections([]);
    const objectResult = joinSections({});

    expect(emptyResult).toBe("");
    expect(objectResult).toBe("not-array");
    expect(designUtilsMocks.joinSections).toHaveBeenCalledTimes(2);
  });

  it("preserves boundary numeric values inside arrays", () => {
    const sections = [0, -1, Number.MAX_SAFE_INTEGER];
    designUtilsMocks.joinSections.mockImplementation((value) => value.map((item) => String(item)).join(","));

    const result = joinSections(sections);

    expect(result).toBe(`0,-1,${Number.MAX_SAFE_INTEGER}`);
    expect(designUtilsMocks.joinSections).toHaveBeenCalledWith(sections);
  });

  it("supports concurrent calls with large payloads", async () => {
    const largeSections = Array.from({ length: 5000 }, (_, index) => `<section>${index}</section>`);
    const inputs = [largeSections, ["one"], ["two", "three"]];
    designUtilsMocks.joinSections.mockImplementation((value) => String(Array.isArray(value) ? value.length : -1));

    const results = await Promise.all(inputs.map((value) => Promise.resolve(joinSections(value))));

    expect(results).toEqual(["5000", "1", "2"]);
    expect(designUtilsMocks.joinSections).toHaveBeenCalledTimes(inputs.length);
  });

  it("surfaces errors from design-utils", () => {
    const err = new Error("join failed");
    designUtilsMocks.joinSections.mockImplementation(() => {
      throw err;
    });

    expect(() => joinSections(["x"])).toThrow(err);
  });
});

describe("extractElements", () => {
  let extractElements;

  beforeEach(async () => {
    vi.resetModules();
    resetDesignUtilsMocks();
    ({ extractElements } = await loadToolsModule());
  });

  it("delegates to design-utils for normal HTML", () => {
    const html = '<section><h1 data-el="title">Hi</h1></section>';
    const expected = [
      {
        elementId: "title",
        tag: "h1",
        attrs: { "data-el": "title" },
        id: "hero",
        class: "lead",
        textPreview: "Hi",
      },
    ];
    designUtilsMocks.extractElements.mockImplementation(() => expected);

    const result = extractElements(html);

    expect(result).toEqual(expected);
    expect(designUtilsMocks.extractElements).toHaveBeenCalledWith(html);
  });

  it("handles null, undefined, and blank inputs", () => {
    const inputs = [null, undefined, "", "   "];
    designUtilsMocks.extractElements.mockImplementation((value) =>
      typeof value === "string" && value.trim() ? [{ elementId: "ok", tag: "div", attrs: {} }] : []
    );

    const results = inputs.map((value) => extractElements(value));

    expect(results).toEqual([[], [], [], []]);
    expect(designUtilsMocks.extractElements.mock.calls.map((call) => call[0])).toEqual(inputs);
  });

  it("supports deep nesting and long HTML strings", () => {
    const depth = 120;
    const html = `<section>${"<div>".repeat(depth)}<span data-el="deep">x</span>${"</div>".repeat(depth)}</section>`;
    designUtilsMocks.extractElements.mockImplementation((value) => {
      const matches = [...String(value).matchAll(/data-el="([^"]+)"/g)];
      return matches.map((match) => ({
        elementId: match[1],
        tag: "span",
        attrs: { "data-el": match[1] },
      }));
    });

    const result = extractElements(html);

    expect(result).toEqual([{ elementId: "deep", tag: "span", attrs: { "data-el": "deep" } }]);
    expect(designUtilsMocks.extractElements).toHaveBeenCalledWith(html);
  });

  it("supports concurrent calls", async () => {
    const inputs = ["one", "two", "three"];
    designUtilsMocks.extractElements.mockImplementation((value) => {
      const id = String(value).slice(0, 5);
      return [{ elementId: id, tag: "div", attrs: { "data-el": id } }];
    });

    const results = await Promise.all(inputs.map((value) => Promise.resolve(extractElements(value))));

    expect(results.map((items) => items[0].elementId)).toEqual(inputs.map((value) => value.slice(0, 5)));
    expect(designUtilsMocks.extractElements).toHaveBeenCalledTimes(inputs.length);
  });

  it("surfaces errors from design-utils", () => {
    const err = new Error("extract failed");
    designUtilsMocks.extractElements.mockImplementation(() => {
      throw err;
    });

    expect(() => extractElements("<section></section>")).toThrow(err);
  });
});
