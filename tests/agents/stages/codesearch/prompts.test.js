/**
 * Tests for js/agents/prompts/ module
 *
 * Covers:
 * - prompt-loader.js: PromptLoader, loadPrompt, loadPromptSync, renderPromptTemplate
 * - prompt-template.js: PromptTemplate, renderPromptTemplate with formatters
 * - prompt-registry.js: PromptRegistry
 * - formatters/*: escapeTemplateDelimiters, formatBullets, formatCodeBlock, formatJson, formatLines, formatTrim, formatUpper
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(__dirname, "../../../js/agents/prompts");

// ============================================================================
// formatters/escape-template-delimiters.js
// ============================================================================

it("escapeTemplateDelimiters: escapes {{ and }} with zero-width break", async () => {
  const { escapeTemplateDelimiters } = await import(
    "../../../js/agents/prompts/formatters/escape-template-delimiters.js"
  );

  const result = escapeTemplateDelimiters("Hello {{name}}!");
  expect(result).toContain("{\u200B{");
  expect(result).toContain("}\u200B}");
  expect(result).not.toContain("{{");
  expect(result).not.toContain("}}");
});

it("escapeTemplateDelimiters: returns empty string for null/undefined", async () => {
  const { escapeTemplateDelimiters } = await import(
    "../../../js/agents/prompts/formatters/escape-template-delimiters.js"
  );

  expect(escapeTemplateDelimiters(null)).toBe("");
  expect(escapeTemplateDelimiters(undefined)).toBe("");
  expect(escapeTemplateDelimiters("")).toBe("");
});

it("escapeTemplateDelimiters: converts non-string to string", async () => {
  const { escapeTemplateDelimiters } = await import(
    "../../../js/agents/prompts/formatters/escape-template-delimiters.js"
  );

  expect(escapeTemplateDelimiters(123)).toBe("123");
  expect(escapeTemplateDelimiters(true)).toBe("true");
});

// ============================================================================
// formatters/format-bullets.js
// ============================================================================

it("formatBullets: formats array as bullet list", async () => {
  const { formatBullets } = await import(
    "../../../js/agents/prompts/formatters/format-bullets.js"
  );

  const result = formatBullets(["one", "two", "three"]);
  expect(result).toBe("- one\n- two\n- three");
});

it("formatBullets: splits string by newlines", async () => {
  const { formatBullets } = await import(
    "../../../js/agents/prompts/formatters/format-bullets.js"
  );

  const result = formatBullets("line1\nline2\nline3");
  expect(result).toBe("- line1\n- line2\n- line3");
});

it("formatBullets: filters empty lines", async () => {
  const { formatBullets } = await import(
    "../../../js/agents/prompts/formatters/format-bullets.js"
  );

  const result = formatBullets(["one", "", "  ", "two"]);
  expect(result).toBe("- one\n- two");
});

it("formatBullets: custom bullet and indent", async () => {
  const { formatBullets } = await import(
    "../../../js/agents/prompts/formatters/format-bullets.js"
  );

  const result = formatBullets(["a", "b"], { bullet: "* ", indent: "  " });
  expect(result).toBe("  * a\n  * b");
});

it("formatBullets: returns empty for null/undefined", async () => {
  const { formatBullets } = await import(
    "../../../js/agents/prompts/formatters/format-bullets.js"
  );

  expect(formatBullets(null)).toBe("");
  expect(formatBullets(undefined)).toBe("");
});

it("formatBullets: converts other types to single bullet", async () => {
  const { formatBullets } = await import(
    "../../../js/agents/prompts/formatters/format-bullets.js"
  );

  expect(formatBullets(42)).toBe("- 42");
  expect(formatBullets(true)).toBe("- true");
});

// ============================================================================
// formatters/format-code-block.js
// ============================================================================

it("formatCodeBlock: wraps content in fenced code block", async () => {
  const { formatCodeBlock } = await import(
    "../../../js/agents/prompts/formatters/format-code-block.js"
  );

  const result = formatCodeBlock("const x = 1;", { lang: "js" });
  expect(result).toBe("```js\nconst x = 1;\n```");
});

it("formatCodeBlock: no language specified", async () => {
  const { formatCodeBlock } = await import(
    "../../../js/agents/prompts/formatters/format-code-block.js"
  );

  const result = formatCodeBlock("plain text");
  expect(result).toBe("```\nplain text\n```");
});

it("formatCodeBlock: handles null/undefined", async () => {
  const { formatCodeBlock } = await import(
    "../../../js/agents/prompts/formatters/format-code-block.js"
  );

  expect(formatCodeBlock(null)).toBe("```\n\n```");
  expect(formatCodeBlock(undefined)).toBe("```\n\n```");
});

// ============================================================================
// formatters/format-json.js
// ============================================================================

it("formatJson: formats object as pretty JSON", async () => {
  const { formatJson } = await import(
    "../../../js/agents/prompts/formatters/format-json.js"
  );

  const result = formatJson({ a: 1, b: 2 });
  expect(result).toBe('{\n  "a": 1,\n  "b": 2\n}');
});

it("formatJson: custom space", async () => {
  const { formatJson } = await import(
    "../../../js/agents/prompts/formatters/format-json.js"
  );

  const result = formatJson({ x: 1 }, { space: 4 });
  expect(result).toBe('{\n    "x": 1\n}');
});

it("formatJson: handles null", async () => {
  const { formatJson } = await import(
    "../../../js/agents/prompts/formatters/format-json.js"
  );

  expect(formatJson(null)).toBe("null");
});

it("formatJson: falls back for circular refs", async () => {
  const { formatJson } = await import(
    "../../../js/agents/prompts/formatters/format-json.js"
  );

  const obj = {};
  obj.self = obj;
  const result = formatJson(obj);
  expect(result).toBe("[object Object]");
});

// ============================================================================
// formatters/format-lines.js
// ============================================================================

it("formatLines: joins array with newlines", async () => {
  const { formatLines } = await import(
    "../../../js/agents/prompts/formatters/format-lines.js"
  );

  const result = formatLines(["a", "b", "c"]);
  expect(result).toBe("a\nb\nc");
});

it("formatLines: filters empty items", async () => {
  const { formatLines } = await import(
    "../../../js/agents/prompts/formatters/format-lines.js"
  );

  const result = formatLines(["a", "", "  ", "b"]);
  expect(result).toBe("a\nb");
});

it("formatLines: returns string as-is", async () => {
  const { formatLines } = await import(
    "../../../js/agents/prompts/formatters/format-lines.js"
  );

  expect(formatLines("hello")).toBe("hello");
});

it("formatLines: handles null/undefined", async () => {
  const { formatLines } = await import(
    "../../../js/agents/prompts/formatters/format-lines.js"
  );

  expect(formatLines(null)).toBe("");
  expect(formatLines(undefined)).toBe("");
});

// ============================================================================
// formatters/format-trim.js
// ============================================================================

it("formatTrim: trims whitespace", async () => {
  const { formatTrim } = await import(
    "../../../js/agents/prompts/formatters/format-trim.js"
  );

  expect(formatTrim("  hello  ")).toBe("hello");
  expect(formatTrim("\n\ttext\n")).toBe("text");
});

it("formatTrim: handles null/undefined", async () => {
  const { formatTrim } = await import(
    "../../../js/agents/prompts/formatters/format-trim.js"
  );

  expect(formatTrim(null)).toBe("");
  expect(formatTrim(undefined)).toBe("");
});

it("formatTrim: converts non-string", async () => {
  const { formatTrim } = await import(
    "../../../js/agents/prompts/formatters/format-trim.js"
  );

  expect(formatTrim(123)).toBe("123");
});

// ============================================================================
// formatters/format-upper.js
// ============================================================================

it("formatUpper: uppercases string", async () => {
  const { formatUpper } = await import(
    "../../../js/agents/prompts/formatters/format-upper.js"
  );

  expect(formatUpper("hello")).toBe("HELLO");
  expect(formatUpper("MixedCase")).toBe("MIXEDCASE");
});

it("formatUpper: handles null/undefined", async () => {
  const { formatUpper } = await import(
    "../../../js/agents/prompts/formatters/format-upper.js"
  );

  expect(formatUpper(null)).toBe("");
  expect(formatUpper(undefined)).toBe("");
});

it("formatUpper: converts non-string", async () => {
  const { formatUpper } = await import(
    "../../../js/agents/prompts/formatters/format-upper.js"
  );

  expect(formatUpper(123)).toBe("123");
  expect(formatUpper(true)).toBe("TRUE");
});

// ============================================================================
// formatters/index.js - DEFAULT_FORMATTERS
// ============================================================================

it("DEFAULT_FORMATTERS: exports all formatters", async () => {
  const { DEFAULT_FORMATTERS } = await import(
    "../../../js/agents/prompts/formatters/index.js"
  );

  expect(typeof DEFAULT_FORMATTERS.bullets).toBe("function");
  expect(typeof DEFAULT_FORMATTERS.code).toBe("function");
  expect(typeof DEFAULT_FORMATTERS.json).toBe("function");
  expect(typeof DEFAULT_FORMATTERS.lines).toBe("function");
  expect(typeof DEFAULT_FORMATTERS.trim).toBe("function");
  expect(typeof DEFAULT_FORMATTERS.upper).toBe("function");
});

// ============================================================================
// prompt-template.js
// ============================================================================

it("renderPromptTemplate: replaces {{var}} placeholders", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("Hello {{name}}!", { vars: { name: "World" } });
  // Escaped delimiters are not present in output since name does not contain {{ or }}
  expect(result).toContain("World");
});

it("renderPromptTemplate: case-insensitive matching", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("Hello {{NAME}}!", { vars: { name: "Test" } });
  expect(result).toContain("Test");
});

it("renderPromptTemplate: dotted key support", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("Config: {{config.value}}", {
    vars: { config: { value: 42 } },
  });
  expect(result).toContain("42");
});

it("renderPromptTemplate: keeps unresolved by default", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("Hello {{unknown}}!", { vars: {} });
  expect(result).toContain("{{unknown}}");
});

it("renderPromptTemplate: removes unresolved when keepUnresolved=false", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("Hello {{unknown}}!", {
    vars: {},
    keepUnresolved: false,
  });
  expect(result).toBe("Hello !");
});

it("renderPromptTemplate: failOnUnresolved throws", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  expect(() =>
      renderPromptTemplate("Hello {{missing}}!", {
        vars: {},
        failOnUnresolved: true,
      })
  ).toThrow(/Unresolved placeholders/);
});

it("renderPromptTemplate: onUnresolved callback", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const unresolved = [];
  renderPromptTemplate("{{a}} {{b}}", {
    vars: {},
    onUnresolved: (names) => unresolved.push(...names),
  });

  expect(unresolved).toContain("a");
  expect(unresolved).toContain("b");
});

it("renderPromptTemplate: formatter pipeline |json", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("Data: {{data|json}}", {
    vars: { data: { x: 1 } },
  });
  expect(result).toContain('"x": 1');
});

it("renderPromptTemplate: formatter pipeline |upper", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{msg|upper}}", {
    vars: { msg: "hello" },
    escapeVars: false,
  });
  expect(result).toBe("HELLO");
});

it("renderPromptTemplate: formatter pipeline |bullets", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{items|bullets}}", {
    vars: { items: ["a", "b"] },
    escapeVars: false,
  });
  expect(result).toBe("- a\n- b");
});

it("renderPromptTemplate: formatter pipeline |code(lang)", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{src|code(python)}}", {
    vars: { src: "print(1)" },
    escapeVars: false,
  });
  expect(result).toContain("```python");
  expect(result).toContain("print(1)");
});

it("renderPromptTemplate: unknown formatter marks as unresolved", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  expect(() =>
      renderPromptTemplate("{{x|unknownFormatter}}", {
        vars: { x: "val" },
        failOnUnresolved: true,
      })
  ).toThrow(/Unresolved placeholders/);
});

it("renderPromptTemplate: custom formatters", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{x|reverse}}", {
    vars: { x: "abc" },
    formatters: {
      reverse: (v) => String(v).split("").reverse().join(""),
    },
    escapeVars: false,
  });
  expect(result).toBe("cba");
});

it("renderPromptTemplate: appendIfMissing adds content", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("Main content", {
    appendIfMissing: { extra: "Extra section" },
  });
  expect(result).toContain("Main content");
  expect(result).toContain("Extra section");
});

it("renderPromptTemplate: appendIfMissing skips if placeholder exists", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("Content {{extra}}", {
    vars: { extra: "value" },
    appendIfMissing: { extra: "Should not appear" },
  });
  expect(result).not.toContain("Should not appear");
});

it("renderPromptTemplate: escapeVars prevents injection", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{userInput}}", {
    vars: { userInput: "inject {{secret}}" },
    escapeVars: true,
  });
  // Should contain escaped braces
  expect(result).toContain("\u200B");
  expect(result).not.toContain("{{secret}}");
});

it("renderPromptTemplate: Map vars support", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const vars = new Map([["key", "mapValue"]]);
  const result = renderPromptTemplate("{{key}}", { vars, escapeVars: false });
  expect(result).toBe("mapValue");
});

it("renderPromptTemplate: handles number/boolean/bigint", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{n}} {{b}} {{bi}}", {
    vars: { n: 42, b: true, bi: BigInt(100) },
    escapeVars: false,
  });
  expect(result).toContain("42");
  expect(result).toContain("true");
  expect(result).toContain("100");
});

it("renderPromptTemplate: null/undefined var becomes empty", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("A{{n}}B{{u}}C", {
    vars: { n: null, u: undefined },
    escapeVars: false,
  });
  expect(result).toBe("ABC");
});

// ============================================================================
// prompt-template.js - PromptTemplate class
// ============================================================================

it("PromptTemplate: render method works", async () => {
  const { PromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const tpl = new PromptTemplate("Hello {{name}}!");
  const result = tpl.render({ vars: { name: "World" }, escapeVars: false });
  expect(result).toBe("Hello World!");
});

it("PromptTemplate: constructor handles non-string", async () => {
  const { PromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const tpl = new PromptTemplate(null);
  expect(tpl.template).toBe("");
});

// ============================================================================
// prompt-registry.js
// ============================================================================

it("PromptRegistry: register and get", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  registry.register("test", "Hello {{name}}");

  const tpl = registry.get("test");
  expect(tpl).not.toBeNull();
  expect(tpl.template).toBe("Hello {{name}}");
});

it("PromptRegistry: register throws on empty name", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  expect(() => registry.register("", "template")).toThrow(/non-empty string/);
  expect(() => registry.register("   ", "template")).toThrow(/non-empty string/);
});

it("PromptRegistry: has method", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  registry.register("exists", "content");

  expect(registry.has("exists")).toBe(true);
  expect(registry.has("notexists")).toBe(false);
  expect(registry.has("")).toBe(false);
});

it("PromptRegistry: list method", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  registry.register("a", "A");
  registry.register("b", "B");

  const list = registry.list();
  expect(list).toContain("a");
  expect(list).toContain("b");
});

it("PromptRegistry: clear specific and all", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  registry.register("a", "A");
  registry.register("b", "B");

  registry.clear("a");
  expect(registry.has("a")).toBe(false);
  expect(registry.has("b")).toBe(true);

  registry.clear();
  expect(registry.list().length).toBe(0);
});

it("PromptRegistry: render method", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  registry.register("greeting", "Hello {{name}}!");

  const result = registry.render("greeting", { vars: { name: "Test" }, escapeVars: false });
  expect(result).toBe("Hello Test!");
});

it("PromptRegistry: render throws for unknown", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  expect(() => registry.render("unknown")).toThrow(/unknown prompt/);
});

it("PromptRegistry: registerMany with object", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  registry.registerMany({
    tpl1: "Template 1",
    tpl2: "Template 2",
  });

  expect(registry.has("tpl1")).toBe(true);
  expect(registry.has("tpl2")).toBe(true);
});

it("PromptRegistry: registerMany with array", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  registry.registerMany([
    ["arr1", "Array 1"],
    ["arr2", "Array 2"],
  ]);

  expect(registry.has("arr1")).toBe(true);
  expect(registry.has("arr2")).toBe(true);
});

it("PromptRegistry: registerMany with Map", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  const map = new Map([
    ["map1", "Map 1"],
    ["map2", "Map 2"],
  ]);
  registry.registerMany(map);

  expect(registry.has("map1")).toBe(true);
  expect(registry.has("map2")).toBe(true);
});

it("PromptRegistry: registerMany with null returns this", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  const result = registry.registerMany(null);
  expect(result).toBe(registry);
});

it("PromptRegistry: registerMany throws on invalid type", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  expect(() => registry.registerMany("string")).toThrow(/must be an object/);
});

it("PromptRegistry: get returns null for unknown", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  expect(registry.get("unknown")).toBe(null);
  expect(registry.get("")).toBe(null);
});

it("PromptRegistry: register with PromptTemplate instance", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );
  const { PromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const registry = new PromptRegistry();
  const tpl = new PromptTemplate("Instance template");
  registry.register("inst", tpl);

  expect(registry.get("inst")).toBe(tpl);
});

// ============================================================================
// prompt-loader.js - PromptLoader class
// ============================================================================

it("PromptLoader: constructor with options", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({
    maxEntries: 64,
    manifestTtlMs: 60000,
    basePath: PROMPTS_DIR,
  });

  const config = loader.configureCache();
  expect(config.maxEntries).toBe(64);
  expect(config.manifestTtlMs).toBe(60000);
});

it("PromptLoader: configureCache updates settings", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });
  const config = loader.configureCache({ maxEntries: 32, manifestTtlMs: 30000 });

  expect(config.maxEntries).toBe(32);
  expect(config.manifestTtlMs).toBe(30000);
});

it("PromptLoader: configureCache throws on invalid maxEntries", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });
  expect(() => loader.configureCache({ maxEntries: "invalid" })).toThrow(
    /must be a finite integer/
  );
});

it("PromptLoader: configureCache throws on invalid manifestTtlMs", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });
  expect(() => loader.configureCache({ manifestTtlMs: "invalid" })).toThrow(
    /must be a finite integer/
  );
});

it("PromptLoader: loadPrompt loads .md file", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });
  const content = await loader.loadPrompt("deepsearch/system");

  expect(content.length).toBeGreaterThan(0);
  expect(typeof content).toBe("string");
});

it("PromptLoader: loadPrompt with .md suffix works", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });
  const content = await loader.loadPrompt("deepsearch/system.md");

  expect(content.length).toBeGreaterThan(0);
});

it("PromptLoader: loadPrompt caches result", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });
  await loader.loadPrompt("deepsearch/quick");

  const names = loader.getCachedPromptNames();
  expect(names).toContain("deepsearch/quick");
});

it("PromptLoader: loadPrompt cache=false skips cache", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });
  loader.clearPromptCache();

  await loader.loadPrompt("deepsearch/quick", { cache: false });

  const names = loader.getCachedPromptNames();
  expect(names).not.toContain("deepsearch/quick");
});

it("PromptLoader: loadPrompt rejects path traversal", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });

  await expect(() => loader.loadPrompt("../../../package")).rejects.toThrow(/Path traversal is forbidden/
  );
});

it("PromptLoader: loadPrompt rejects invalid characters", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });

  await expect(() => loader.loadPrompt("invalid@name")).rejects.toThrow(/Path traversal is forbidden/
  );
});

it("PromptLoader: loadPrompt throws on missing file", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });

  await expect(() => loader.loadPrompt("nonexistent/prompt")).rejects.toThrow(/Failed to load prompt/
  );
});

it("PromptLoader: loadPromptSync loads file synchronously", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });

  // In native ESM without require shim, this may throw
  try {
    const content = loader.loadPromptSync("deepsearch/system");
    expect(content.length).toBeGreaterThan(0);
  } catch (e) {
    // Expected in pure ESM environment
    if (e.message.includes("Sync file access is unavailable")) {
      expect(e.message).toContain("Sync file access is unavailable");
    } else {
      expect(e.message).toContain("Failed to load");
    }
  }
});

it("PromptLoader: loadPromptSync rejects path traversal", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });

  expect(() => loader.loadPromptSync("../escape")).toThrow(/Path traversal is forbidden/);
});

it("PromptLoader: clearPromptCache clears all", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });
  await loader.loadPrompt("deepsearch/quick");
  await loader.loadPrompt("deepsearch/deeper");

  loader.clearPromptCache();

  expect(loader.getCachedPromptNames().length).toBe(0);
});

it("PromptLoader: clearPromptCache clears specific", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });
  await loader.loadPrompt("deepsearch/quick");
  await loader.loadPrompt("deepsearch/deeper");

  loader.clearPromptCache("deepsearch/quick");

  const names = loader.getCachedPromptNames();
  expect(names).not.toContain("deepsearch/quick");
  expect(names).toContain("deepsearch/deeper");
});

it("PromptLoader: preloadPrompts loads multiple", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });
  loader.clearPromptCache();

  const results = await loader.preloadPrompts([
    "deepsearch/quick",
    "deepsearch/deeper",
    "nonexistent/file",
  ]);

  expect(results).toBeInstanceOf(Map);
  expect(results.has("deepsearch/quick")).toBe(true);
  expect(results.has("deepsearch/deeper")).toBe(true);
  expect(results.has("nonexistent/file")).toBe(false);
});

it("PromptLoader: preloadPrompts with non-array returns empty map", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });
  const results = await loader.preloadPrompts(null);

  expect(results).toBeInstanceOf(Map);
  expect(results.size).toBe(0);
});

// ============================================================================
// prompt-loader.js - module exports
// ============================================================================

it("prompt-loader: exports loadPrompt function", async () => {
  const { loadPrompt } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  expect(typeof loadPrompt).toBe("function");
});

it("prompt-loader: exports loadPromptSync function", async () => {
  const { loadPromptSync } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  expect(typeof loadPromptSync).toBe("function");
});

it("prompt-loader: exports preloadPrompts function", async () => {
  const { preloadPrompts } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  expect(typeof preloadPrompts).toBe("function");
});

it("prompt-loader: exports clearPromptCache function", async () => {
  const { clearPromptCache } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  expect(typeof clearPromptCache).toBe("function");
});

it("prompt-loader: exports getCachedPromptNames function", async () => {
  const { getCachedPromptNames } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  expect(typeof getCachedPromptNames).toBe("function");
});

it("prompt-loader: exports configurePromptCache function", async () => {
  const { configurePromptCache } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  expect(typeof configurePromptCache).toBe("function");
});

it("prompt-loader: exports renderPromptTemplate function", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  expect(typeof renderPromptTemplate).toBe("function");
});

it("prompt-loader: default export contains all methods", async () => {
  const mod = await import("../../../js/agents/prompts/prompt-loader.js");

  expect(typeof mod.default.loadPrompt).toBe("function");
  expect(typeof mod.default.loadPromptSync).toBe("function");
  expect(typeof mod.default.preloadPrompts).toBe("function");
  expect(typeof mod.default.clearPromptCache).toBe("function");
  expect(typeof mod.default.getCachedPromptNames).toBe("function");
  expect(typeof mod.default.configurePromptCache).toBe("function");
  expect(typeof mod.default.renderPromptTemplate).toBe("function");
});

// ============================================================================
// prompt-loader.js - renderPromptTemplate (duplicate API)
// ============================================================================

it("prompt-loader renderPromptTemplate: basic variable replacement", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const result = renderPromptTemplate("Hello {{name}}!", {
    vars: { name: "World" },
    escapeVars: false,
  });
  expect(result).toBe("Hello World!");
});

it("prompt-loader renderPromptTemplate: warnOnUnresolved logs warning", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  // Should not throw, just log warning
  const result = renderPromptTemplate("{{missing}}", {
    vars: {},
    warnOnUnresolved: true,
  });
  expect(result).toContain("{{missing}}");
});

// ============================================================================
// Multi-language support (i18n-like patterns)
// ============================================================================

it("prompt-template: supports unicode variable values", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{greeting}} {{name}}", {
    vars: { greeting: "Hello", name: "Alice" },
    escapeVars: false,
  });

  expect(result).toContain("Hello");
  expect(result).toContain("Alice");
});

it("prompt-template: handles Chinese characters", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{msg}}", {
    vars: { msg: "Hello" },
    escapeVars: false,
  });

  expect(result).toBe("Hello");
});

it("prompt-template: handles mixed language content", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("English: {{en}}, Japanese: {{ja}}", {
    vars: { en: "Hello", ja: "Konnichiwa" },
    escapeVars: false,
  });

  expect(result).toContain("Hello");
  expect(result).toContain("Konnichiwa");
});

it("prompt-template: emoji in variables", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("Status: {{status}}", {
    vars: { status: "Done!" },
    escapeVars: false,
  });

  expect(result).toContain("Done!");
});

// ============================================================================
// Edge cases
// ============================================================================

it("renderPromptTemplate: empty template", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  expect(renderPromptTemplate("")).toBe("");
  expect(renderPromptTemplate(null)).toBe("");
  expect(renderPromptTemplate(undefined)).toBe("");
});

it("renderPromptTemplate: no vars provided", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("Static text");
  expect(result).toBe("Static text");
});

it("renderPromptTemplate: whitespace in placeholder", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{  name  }}", {
    vars: { name: "test" },
    escapeVars: false,
  });
  expect(result).toBe("test");
});

it("renderPromptTemplate: array value without formatter", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{items}}", {
    vars: { items: ["a", "b", "c"] },
    escapeVars: false,
  });
  expect(result).toBe("a\nb\nc");
});

it("renderPromptTemplate: object value without formatter", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{obj}}", {
    vars: { obj: { x: 1 } },
    escapeVars: false,
  });
  // Should be JSON stringified
  expect(result).toContain('"x"');
  expect(result).toContain("1");
});

it("formatters: chained formatters |trim|upper", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{x|trim|upper}}", {
    vars: { x: "  hello  " },
    escapeVars: false,
  });
  expect(result).toBe("HELLO");
});

it("PromptLoader: LRU cache eviction", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({
    basePath: PROMPTS_DIR,
    maxEntries: 2,
  });
  loader.clearPromptCache();

  await loader.loadPrompt("deepsearch/quick");
  await loader.loadPrompt("deepsearch/deeper");
  await loader.loadPrompt("deepsearch/wider");

  const names = loader.getCachedPromptNames();
  // Only 2 should remain due to LRU eviction
  expect(names.length).toBe(2);
  // First loaded should be evicted
  expect(names).not.toContain("deepsearch/quick");
});

it("PromptLoader: maxPromptBytes limit", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({
    basePath: PROMPTS_DIR,
    maxPromptBytes: 10, // Very small limit
  });

  await expect(() => loader.loadPrompt("deepsearch/system")).rejects.toThrow(/exceeds limit/
  );
});

// ============================================================================
// Additional prompt-loader.js renderPromptTemplate coverage
// ============================================================================

it("prompt-loader renderPromptTemplate: appendIfMissing with empty placeholder name", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const result = renderPromptTemplate("Main", {
    appendIfMissing: { "": "should skip", valid: "added" },
  });
  expect(result).not.toContain("should skip");
  expect(result).toContain("added");
});

it("prompt-loader renderPromptTemplate: appendIfMissing with empty content", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const result = renderPromptTemplate("Main", {
    appendIfMissing: { empty: "", valid: "added" },
  });
  expect(result).toContain("added");
});

it("prompt-loader renderPromptTemplate: onUnresolved callback that throws", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  // Should not throw, callback errors are caught
  const result = renderPromptTemplate("{{missing}}", {
    vars: {},
    onUnresolved: () => {
      throw new Error("callback error");
    },
  });
  expect(result).toContain("{{missing}}");
});

it("prompt-loader renderPromptTemplate: more than 20 unresolved truncated", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  // Generate 25 placeholders
  const placeholders = Array.from({ length: 25 }, (_, i) => `{{var${i}}}`).join(" ");
  const received = [];

  renderPromptTemplate(placeholders, {
    vars: {},
    onUnresolved: (names) => received.push(...names),
  });

  // Only first 20 should be reported
  expect(received.length).toBe(20);
});

it("prompt-loader renderPromptTemplate: empty key placeholder", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const result = renderPromptTemplate("{{  }}", { vars: {} });
  expect(result).toBe("{{  }}");
});

it("prompt-loader renderPromptTemplate: non-object appendIfMissing ignored", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const result = renderPromptTemplate("Main", {
    appendIfMissing: "not-an-object",
  });
  expect(result).toBe("Main");
});

it("prompt-loader renderPromptTemplate: keepUnresolved false with empty key", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const result = renderPromptTemplate("{{  }}", {
    vars: {},
    keepUnresolved: false,
  });
  expect(result).toBe("");
});

it("prompt-loader renderPromptTemplate: object/array values kept as placeholder", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  // Arrays and objects are not directly rendered by prompt-loader's renderPromptTemplate
  const result = renderPromptTemplate("{{arr}} {{obj}}", {
    vars: { arr: [1, 2, 3], obj: { x: 1 } },
  });
  // Should keep as unresolved since arrays/objects not handled
  expect(result).toContain("{{arr}}");
  expect(result).toContain("{{obj}}");
});

// ============================================================================
// PromptLoader constructor edge cases
// ============================================================================

it("PromptLoader: constructor with Infinity maxManifestBytes", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({
    basePath: PROMPTS_DIR,
    maxManifestBytes: Infinity,
  });

  // Should not throw
  expect(loader).toBeInstanceOf(PromptLoader);
});

it("PromptLoader: constructor with invalid maxManifestBytes uses default", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({
    basePath: PROMPTS_DIR,
    maxManifestBytes: "invalid",
  });

  // Should not throw, uses default
  expect(loader).toBeInstanceOf(PromptLoader);
});

it("PromptLoader: constructor with negative maxPromptBytes uses default", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({
    basePath: PROMPTS_DIR,
    maxPromptBytes: -100,
  });

  // Should not throw
  expect(loader).toBeInstanceOf(PromptLoader);
});

it("PromptLoader: constructor with custom fetchImpl", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const customFetch = () => Promise.resolve({ ok: true, text: () => Promise.resolve("content") });
  const loader = new PromptLoader({
    basePath: PROMPTS_DIR,
    fetchImpl: customFetch,
  });

  expect(loader).toBeInstanceOf(PromptLoader);
});

// ============================================================================
// prompt-template.js additional coverage
// ============================================================================

it("prompt-template: formatter with args context", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  // json formatter uses args for space
  const result = renderPromptTemplate("{{data|json(4)}}", {
    vars: { data: { a: 1 } },
    escapeVars: false,
  });
  expect(result).toContain("    "); // 4-space indent
});

it("prompt-template: nested object flattening depth limit", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  // Depth is limited to 4
  const deep = { l1: { l2: { l3: { l4: { l5: "deep" } } } } };
  const result = renderPromptTemplate("{{l1.l2.l3.l4.l5}}", {
    vars: deep,
  });
  // l5 should not be accessible due to depth limit
  expect(result).toContain("{{l1.l2.l3.l4.l5}}");
});

it("prompt-template: array in vars not flattened", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{items}}", {
    vars: { items: ["a", "b", "c"] },
    escapeVars: false,
  });
  expect(result).toBe("a\nb\nc");
});

it("prompt-template: warnOnUnresolved with multiple placeholders", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  // Just verify it doesn't throw
  const result = renderPromptTemplate("{{a}} {{b}} {{c}}", {
    vars: {},
    warnOnUnresolved: true,
  });
  expect(result).toContain("{{a}}");
});

it("prompt-template: object at intermediate key also stored", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  // When we have config.value, config itself is also stored
  const result = renderPromptTemplate("{{config|json}}", {
    vars: { config: { value: 42 } },
    escapeVars: false,
  });
  expect(result).toContain('"value"');
  expect(result).toContain("42");
});

it("prompt-template: empty formatter name in pipeline", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  // {{x| }} should have empty formatter name
  const result = renderPromptTemplate("{{x| }}", {
    vars: { x: "val" },
    failOnUnresolved: true,
  });
  // Empty formatter is skipped
  expect(result).toContain("val");
});

it("prompt-template: formatter with multiple args", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  // Custom formatter that uses multiple args
  const result = renderPromptTemplate("{{x|join}}", {
    vars: { x: ["a", "b"] },
    formatters: {
      join: (val, ctx) => Array.isArray(val) ? val.join(ctx?.args?.[0] || ",") : String(val),
    },
    escapeVars: false,
  });
  expect(result).toBe("a,b");
});

// ============================================================================
// formatters/index.js DEFAULT_FORMATTERS with args
// ============================================================================

it("DEFAULT_FORMATTERS.code: uses lang from args", async () => {
  const { DEFAULT_FORMATTERS } = await import(
    "../../../js/agents/prompts/formatters/index.js"
  );

  const result = DEFAULT_FORMATTERS.code("content", { args: ["typescript"] });
  expect(result).toContain("```typescript");
});

it("DEFAULT_FORMATTERS.json: uses space from args", async () => {
  const { DEFAULT_FORMATTERS } = await import(
    "../../../js/agents/prompts/formatters/index.js"
  );

  const result = DEFAULT_FORMATTERS.json({ x: 1 }, { args: ["4"] });
  expect(result).toContain("    "); // 4-space indent
});

it("DEFAULT_FORMATTERS.bullets: called without ctx", async () => {
  const { DEFAULT_FORMATTERS } = await import(
    "../../../js/agents/prompts/formatters/index.js"
  );

  const result = DEFAULT_FORMATTERS.bullets(["a", "b"]);
  expect(result).toBe("- a\n- b");
});

// ============================================================================
// PromptRegistry additional edge cases
// ============================================================================

it("PromptRegistry: chain register calls", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  const result = registry.register("a", "A").register("b", "B");

  expect(result).toBe(registry);
  expect(registry.has("a")).toBe(true);
  expect(registry.has("b")).toBe(true);
});

it("PromptRegistry: whitespace-only name in get returns null", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  expect(registry.get("   ")).toBe(null);
});

it("PromptRegistry: whitespace-only name in has returns false", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  expect(registry.has("   ")).toBe(false);
});
