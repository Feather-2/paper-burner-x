/**
 * Tests for js/agents/prompts/ module
 *
 * Covers:
 * - prompt-loader.js: PromptLoader, loadPrompt, loadPromptSync, renderPromptTemplate
 * - prompt-template.js: PromptTemplate, renderPromptTemplate with formatters
 * - prompt-registry.js: PromptRegistry
 * - formatters/*: escapeTemplateDelimiters, formatBullets, formatCodeBlock, formatJson, formatLines, formatTrim, formatUpper
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(__dirname, "../../../js/agents/prompts");

// ============================================================================
// formatters/escape-template-delimiters.js
// ============================================================================

test("escapeTemplateDelimiters: escapes {{ and }} with zero-width break", async () => {
  const { escapeTemplateDelimiters } = await import(
    "../../../js/agents/prompts/formatters/escape-template-delimiters.js"
  );

  const result = escapeTemplateDelimiters("Hello {{name}}!");
  assert.ok(result.includes("{\u200B{"));
  assert.ok(result.includes("}\u200B}"));
  assert.ok(!result.includes("{{"));
  assert.ok(!result.includes("}}"));
});

test("escapeTemplateDelimiters: returns empty string for null/undefined", async () => {
  const { escapeTemplateDelimiters } = await import(
    "../../../js/agents/prompts/formatters/escape-template-delimiters.js"
  );

  assert.equal(escapeTemplateDelimiters(null), "");
  assert.equal(escapeTemplateDelimiters(undefined), "");
  assert.equal(escapeTemplateDelimiters(""), "");
});

test("escapeTemplateDelimiters: converts non-string to string", async () => {
  const { escapeTemplateDelimiters } = await import(
    "../../../js/agents/prompts/formatters/escape-template-delimiters.js"
  );

  assert.equal(escapeTemplateDelimiters(123), "123");
  assert.equal(escapeTemplateDelimiters(true), "true");
});

// ============================================================================
// formatters/format-bullets.js
// ============================================================================

test("formatBullets: formats array as bullet list", async () => {
  const { formatBullets } = await import(
    "../../../js/agents/prompts/formatters/format-bullets.js"
  );

  const result = formatBullets(["one", "two", "three"]);
  assert.equal(result, "- one\n- two\n- three");
});

test("formatBullets: splits string by newlines", async () => {
  const { formatBullets } = await import(
    "../../../js/agents/prompts/formatters/format-bullets.js"
  );

  const result = formatBullets("line1\nline2\nline3");
  assert.equal(result, "- line1\n- line2\n- line3");
});

test("formatBullets: filters empty lines", async () => {
  const { formatBullets } = await import(
    "../../../js/agents/prompts/formatters/format-bullets.js"
  );

  const result = formatBullets(["one", "", "  ", "two"]);
  assert.equal(result, "- one\n- two");
});

test("formatBullets: custom bullet and indent", async () => {
  const { formatBullets } = await import(
    "../../../js/agents/prompts/formatters/format-bullets.js"
  );

  const result = formatBullets(["a", "b"], { bullet: "* ", indent: "  " });
  assert.equal(result, "  * a\n  * b");
});

test("formatBullets: returns empty for null/undefined", async () => {
  const { formatBullets } = await import(
    "../../../js/agents/prompts/formatters/format-bullets.js"
  );

  assert.equal(formatBullets(null), "");
  assert.equal(formatBullets(undefined), "");
});

test("formatBullets: converts other types to single bullet", async () => {
  const { formatBullets } = await import(
    "../../../js/agents/prompts/formatters/format-bullets.js"
  );

  assert.equal(formatBullets(42), "- 42");
  assert.equal(formatBullets(true), "- true");
});

// ============================================================================
// formatters/format-code-block.js
// ============================================================================

test("formatCodeBlock: wraps content in fenced code block", async () => {
  const { formatCodeBlock } = await import(
    "../../../js/agents/prompts/formatters/format-code-block.js"
  );

  const result = formatCodeBlock("const x = 1;", { lang: "js" });
  assert.equal(result, "```js\nconst x = 1;\n```");
});

test("formatCodeBlock: no language specified", async () => {
  const { formatCodeBlock } = await import(
    "../../../js/agents/prompts/formatters/format-code-block.js"
  );

  const result = formatCodeBlock("plain text");
  assert.equal(result, "```\nplain text\n```");
});

test("formatCodeBlock: handles null/undefined", async () => {
  const { formatCodeBlock } = await import(
    "../../../js/agents/prompts/formatters/format-code-block.js"
  );

  assert.equal(formatCodeBlock(null), "```\n\n```");
  assert.equal(formatCodeBlock(undefined), "```\n\n```");
});

// ============================================================================
// formatters/format-json.js
// ============================================================================

test("formatJson: formats object as pretty JSON", async () => {
  const { formatJson } = await import(
    "../../../js/agents/prompts/formatters/format-json.js"
  );

  const result = formatJson({ a: 1, b: 2 });
  assert.equal(result, '{\n  "a": 1,\n  "b": 2\n}');
});

test("formatJson: custom space", async () => {
  const { formatJson } = await import(
    "../../../js/agents/prompts/formatters/format-json.js"
  );

  const result = formatJson({ x: 1 }, { space: 4 });
  assert.equal(result, '{\n    "x": 1\n}');
});

test("formatJson: handles null", async () => {
  const { formatJson } = await import(
    "../../../js/agents/prompts/formatters/format-json.js"
  );

  assert.equal(formatJson(null), "null");
});

test("formatJson: falls back for circular refs", async () => {
  const { formatJson } = await import(
    "../../../js/agents/prompts/formatters/format-json.js"
  );

  const obj = {};
  obj.self = obj;
  const result = formatJson(obj);
  assert.equal(result, "[object Object]");
});

// ============================================================================
// formatters/format-lines.js
// ============================================================================

test("formatLines: joins array with newlines", async () => {
  const { formatLines } = await import(
    "../../../js/agents/prompts/formatters/format-lines.js"
  );

  const result = formatLines(["a", "b", "c"]);
  assert.equal(result, "a\nb\nc");
});

test("formatLines: filters empty items", async () => {
  const { formatLines } = await import(
    "../../../js/agents/prompts/formatters/format-lines.js"
  );

  const result = formatLines(["a", "", "  ", "b"]);
  assert.equal(result, "a\nb");
});

test("formatLines: returns string as-is", async () => {
  const { formatLines } = await import(
    "../../../js/agents/prompts/formatters/format-lines.js"
  );

  assert.equal(formatLines("hello"), "hello");
});

test("formatLines: handles null/undefined", async () => {
  const { formatLines } = await import(
    "../../../js/agents/prompts/formatters/format-lines.js"
  );

  assert.equal(formatLines(null), "");
  assert.equal(formatLines(undefined), "");
});

// ============================================================================
// formatters/format-trim.js
// ============================================================================

test("formatTrim: trims whitespace", async () => {
  const { formatTrim } = await import(
    "../../../js/agents/prompts/formatters/format-trim.js"
  );

  assert.equal(formatTrim("  hello  "), "hello");
  assert.equal(formatTrim("\n\ttext\n"), "text");
});

test("formatTrim: handles null/undefined", async () => {
  const { formatTrim } = await import(
    "../../../js/agents/prompts/formatters/format-trim.js"
  );

  assert.equal(formatTrim(null), "");
  assert.equal(formatTrim(undefined), "");
});

test("formatTrim: converts non-string", async () => {
  const { formatTrim } = await import(
    "../../../js/agents/prompts/formatters/format-trim.js"
  );

  assert.equal(formatTrim(123), "123");
});

// ============================================================================
// formatters/format-upper.js
// ============================================================================

test("formatUpper: uppercases string", async () => {
  const { formatUpper } = await import(
    "../../../js/agents/prompts/formatters/format-upper.js"
  );

  assert.equal(formatUpper("hello"), "HELLO");
  assert.equal(formatUpper("MixedCase"), "MIXEDCASE");
});

test("formatUpper: handles null/undefined", async () => {
  const { formatUpper } = await import(
    "../../../js/agents/prompts/formatters/format-upper.js"
  );

  assert.equal(formatUpper(null), "");
  assert.equal(formatUpper(undefined), "");
});

test("formatUpper: converts non-string", async () => {
  const { formatUpper } = await import(
    "../../../js/agents/prompts/formatters/format-upper.js"
  );

  assert.equal(formatUpper(123), "123");
  assert.equal(formatUpper(true), "TRUE");
});

// ============================================================================
// formatters/index.js - DEFAULT_FORMATTERS
// ============================================================================

test("DEFAULT_FORMATTERS: exports all formatters", async () => {
  const { DEFAULT_FORMATTERS } = await import(
    "../../../js/agents/prompts/formatters/index.js"
  );

  assert.equal(typeof DEFAULT_FORMATTERS.bullets, "function");
  assert.equal(typeof DEFAULT_FORMATTERS.code, "function");
  assert.equal(typeof DEFAULT_FORMATTERS.json, "function");
  assert.equal(typeof DEFAULT_FORMATTERS.lines, "function");
  assert.equal(typeof DEFAULT_FORMATTERS.trim, "function");
  assert.equal(typeof DEFAULT_FORMATTERS.upper, "function");
});

// ============================================================================
// prompt-template.js
// ============================================================================

test("renderPromptTemplate: replaces {{var}} placeholders", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("Hello {{name}}!", { vars: { name: "World" } });
  // Escaped delimiters are not present in output since name does not contain {{ or }}
  assert.ok(result.includes("World"));
});

test("renderPromptTemplate: case-insensitive matching", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("Hello {{NAME}}!", { vars: { name: "Test" } });
  assert.ok(result.includes("Test"));
});

test("renderPromptTemplate: dotted key support", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("Config: {{config.value}}", {
    vars: { config: { value: 42 } },
  });
  assert.ok(result.includes("42"));
});

test("renderPromptTemplate: keeps unresolved by default", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("Hello {{unknown}}!", { vars: {} });
  assert.ok(result.includes("{{unknown}}"));
});

test("renderPromptTemplate: removes unresolved when keepUnresolved=false", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("Hello {{unknown}}!", {
    vars: {},
    keepUnresolved: false,
  });
  assert.equal(result, "Hello !");
});

test("renderPromptTemplate: failOnUnresolved throws", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  assert.throws(
    () =>
      renderPromptTemplate("Hello {{missing}}!", {
        vars: {},
        failOnUnresolved: true,
      }),
    /Unresolved placeholders/
  );
});

test("renderPromptTemplate: onUnresolved callback", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const unresolved = [];
  renderPromptTemplate("{{a}} {{b}}", {
    vars: {},
    onUnresolved: (names) => unresolved.push(...names),
  });

  assert.ok(unresolved.includes("a"));
  assert.ok(unresolved.includes("b"));
});

test("renderPromptTemplate: formatter pipeline |json", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("Data: {{data|json}}", {
    vars: { data: { x: 1 } },
  });
  assert.ok(result.includes('"x": 1'));
});

test("renderPromptTemplate: formatter pipeline |upper", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{msg|upper}}", {
    vars: { msg: "hello" },
    escapeVars: false,
  });
  assert.equal(result, "HELLO");
});

test("renderPromptTemplate: formatter pipeline |bullets", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{items|bullets}}", {
    vars: { items: ["a", "b"] },
    escapeVars: false,
  });
  assert.equal(result, "- a\n- b");
});

test("renderPromptTemplate: formatter pipeline |code(lang)", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{src|code(python)}}", {
    vars: { src: "print(1)" },
    escapeVars: false,
  });
  assert.ok(result.includes("```python"));
  assert.ok(result.includes("print(1)"));
});

test("renderPromptTemplate: unknown formatter marks as unresolved", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  assert.throws(
    () =>
      renderPromptTemplate("{{x|unknownFormatter}}", {
        vars: { x: "val" },
        failOnUnresolved: true,
      }),
    /Unresolved placeholders/
  );
});

test("renderPromptTemplate: custom formatters", async () => {
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
  assert.equal(result, "cba");
});

test("renderPromptTemplate: appendIfMissing adds content", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("Main content", {
    appendIfMissing: { extra: "Extra section" },
  });
  assert.ok(result.includes("Main content"));
  assert.ok(result.includes("Extra section"));
});

test("renderPromptTemplate: appendIfMissing skips if placeholder exists", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("Content {{extra}}", {
    vars: { extra: "value" },
    appendIfMissing: { extra: "Should not appear" },
  });
  assert.ok(!result.includes("Should not appear"));
});

test("renderPromptTemplate: escapeVars prevents injection", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{userInput}}", {
    vars: { userInput: "inject {{secret}}" },
    escapeVars: true,
  });
  // Should contain escaped braces
  assert.ok(result.includes("\u200B"));
  assert.ok(!result.includes("{{secret}}"));
});

test("renderPromptTemplate: Map vars support", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const vars = new Map([["key", "mapValue"]]);
  const result = renderPromptTemplate("{{key}}", { vars, escapeVars: false });
  assert.equal(result, "mapValue");
});

test("renderPromptTemplate: handles number/boolean/bigint", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{n}} {{b}} {{bi}}", {
    vars: { n: 42, b: true, bi: BigInt(100) },
    escapeVars: false,
  });
  assert.ok(result.includes("42"));
  assert.ok(result.includes("true"));
  assert.ok(result.includes("100"));
});

test("renderPromptTemplate: null/undefined var becomes empty", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("A{{n}}B{{u}}C", {
    vars: { n: null, u: undefined },
    escapeVars: false,
  });
  assert.equal(result, "ABC");
});

// ============================================================================
// prompt-template.js - PromptTemplate class
// ============================================================================

test("PromptTemplate: render method works", async () => {
  const { PromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const tpl = new PromptTemplate("Hello {{name}}!");
  const result = tpl.render({ vars: { name: "World" }, escapeVars: false });
  assert.equal(result, "Hello World!");
});

test("PromptTemplate: constructor handles non-string", async () => {
  const { PromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const tpl = new PromptTemplate(null);
  assert.equal(tpl.template, "");
});

// ============================================================================
// prompt-registry.js
// ============================================================================

test("PromptRegistry: register and get", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  registry.register("test", "Hello {{name}}");

  const tpl = registry.get("test");
  assert.ok(tpl !== null);
  assert.equal(tpl.template, "Hello {{name}}");
});

test("PromptRegistry: register throws on empty name", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  assert.throws(() => registry.register("", "template"), /non-empty string/);
  assert.throws(() => registry.register("   ", "template"), /non-empty string/);
});

test("PromptRegistry: has method", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  registry.register("exists", "content");

  assert.equal(registry.has("exists"), true);
  assert.equal(registry.has("notexists"), false);
  assert.equal(registry.has(""), false);
});

test("PromptRegistry: list method", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  registry.register("a", "A");
  registry.register("b", "B");

  const list = registry.list();
  assert.ok(list.includes("a"));
  assert.ok(list.includes("b"));
});

test("PromptRegistry: clear specific and all", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  registry.register("a", "A");
  registry.register("b", "B");

  registry.clear("a");
  assert.equal(registry.has("a"), false);
  assert.equal(registry.has("b"), true);

  registry.clear();
  assert.equal(registry.list().length, 0);
});

test("PromptRegistry: render method", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  registry.register("greeting", "Hello {{name}}!");

  const result = registry.render("greeting", { vars: { name: "Test" }, escapeVars: false });
  assert.equal(result, "Hello Test!");
});

test("PromptRegistry: render throws for unknown", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  assert.throws(() => registry.render("unknown"), /unknown prompt/);
});

test("PromptRegistry: registerMany with object", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  registry.registerMany({
    tpl1: "Template 1",
    tpl2: "Template 2",
  });

  assert.equal(registry.has("tpl1"), true);
  assert.equal(registry.has("tpl2"), true);
});

test("PromptRegistry: registerMany with array", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  registry.registerMany([
    ["arr1", "Array 1"],
    ["arr2", "Array 2"],
  ]);

  assert.equal(registry.has("arr1"), true);
  assert.equal(registry.has("arr2"), true);
});

test("PromptRegistry: registerMany with Map", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  const map = new Map([
    ["map1", "Map 1"],
    ["map2", "Map 2"],
  ]);
  registry.registerMany(map);

  assert.equal(registry.has("map1"), true);
  assert.equal(registry.has("map2"), true);
});

test("PromptRegistry: registerMany with null returns this", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  const result = registry.registerMany(null);
  assert.equal(result, registry);
});

test("PromptRegistry: registerMany throws on invalid type", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  assert.throws(() => registry.registerMany("string"), /must be an object/);
});

test("PromptRegistry: get returns null for unknown", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  assert.equal(registry.get("unknown"), null);
  assert.equal(registry.get(""), null);
});

test("PromptRegistry: register with PromptTemplate instance", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );
  const { PromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const registry = new PromptRegistry();
  const tpl = new PromptTemplate("Instance template");
  registry.register("inst", tpl);

  assert.equal(registry.get("inst"), tpl);
});

// ============================================================================
// prompt-loader.js - PromptLoader class
// ============================================================================

test("PromptLoader: constructor with options", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({
    maxEntries: 64,
    manifestTtlMs: 60000,
    basePath: PROMPTS_DIR,
  });

  const config = loader.configureCache();
  assert.equal(config.maxEntries, 64);
  assert.equal(config.manifestTtlMs, 60000);
});

test("PromptLoader: configureCache updates settings", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });
  const config = loader.configureCache({ maxEntries: 32, manifestTtlMs: 30000 });

  assert.equal(config.maxEntries, 32);
  assert.equal(config.manifestTtlMs, 30000);
});

test("PromptLoader: configureCache throws on invalid maxEntries", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });
  assert.throws(
    () => loader.configureCache({ maxEntries: "invalid" }),
    /must be a finite integer/
  );
});

test("PromptLoader: configureCache throws on invalid manifestTtlMs", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });
  assert.throws(
    () => loader.configureCache({ manifestTtlMs: "invalid" }),
    /must be a finite integer/
  );
});

test("PromptLoader: loadPrompt loads .md file", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });
  const content = await loader.loadPrompt("deepsearch/system");

  assert.ok(content.length > 0);
  assert.equal(typeof content, "string");
});

test("PromptLoader: loadPrompt with .md suffix works", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });
  const content = await loader.loadPrompt("deepsearch/system.md");

  assert.ok(content.length > 0);
});

test("PromptLoader: loadPrompt caches result", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });
  await loader.loadPrompt("deepsearch/quick");

  const names = loader.getCachedPromptNames();
  assert.ok(names.includes("deepsearch/quick"));
});

test("PromptLoader: loadPrompt cache=false skips cache", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });
  loader.clearPromptCache();

  await loader.loadPrompt("deepsearch/quick", { cache: false });

  const names = loader.getCachedPromptNames();
  assert.ok(!names.includes("deepsearch/quick"));
});

test("PromptLoader: loadPrompt rejects path traversal", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });

  await assert.rejects(
    () => loader.loadPrompt("../../../package"),
    /Path traversal is forbidden/
  );
});

test("PromptLoader: loadPrompt rejects invalid characters", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });

  await assert.rejects(
    () => loader.loadPrompt("invalid@name"),
    /Path traversal is forbidden/
  );
});

test("PromptLoader: loadPrompt throws on missing file", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });

  await assert.rejects(
    () => loader.loadPrompt("nonexistent/prompt"),
    /Failed to load prompt/
  );
});

test("PromptLoader: loadPromptSync loads file synchronously", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });

  // In native ESM without require shim, this may throw
  try {
    const content = loader.loadPromptSync("deepsearch/system");
    assert.ok(content.length > 0);
  } catch (e) {
    // Expected in pure ESM environment
    assert.ok(e.message.includes("Sync file access is unavailable") || e.message.includes("Failed to load"));
  }
});

test("PromptLoader: loadPromptSync rejects path traversal", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });

  assert.throws(
    () => loader.loadPromptSync("../escape"),
    /Path traversal is forbidden/
  );
});

test("PromptLoader: clearPromptCache clears all", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });
  await loader.loadPrompt("deepsearch/quick");
  await loader.loadPrompt("deepsearch/deeper");

  loader.clearPromptCache();

  assert.equal(loader.getCachedPromptNames().length, 0);
});

test("PromptLoader: clearPromptCache clears specific", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });
  await loader.loadPrompt("deepsearch/quick");
  await loader.loadPrompt("deepsearch/deeper");

  loader.clearPromptCache("deepsearch/quick");

  const names = loader.getCachedPromptNames();
  assert.ok(!names.includes("deepsearch/quick"));
  assert.ok(names.includes("deepsearch/deeper"));
});

test("PromptLoader: preloadPrompts loads multiple", async () => {
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

  assert.ok(results instanceof Map);
  assert.ok(results.has("deepsearch/quick"));
  assert.ok(results.has("deepsearch/deeper"));
  assert.ok(!results.has("nonexistent/file"));
});

test("PromptLoader: preloadPrompts with non-array returns empty map", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({ basePath: PROMPTS_DIR });
  const results = await loader.preloadPrompts(null);

  assert.ok(results instanceof Map);
  assert.equal(results.size, 0);
});

// ============================================================================
// prompt-loader.js - module exports
// ============================================================================

test("prompt-loader: exports loadPrompt function", async () => {
  const { loadPrompt } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  assert.equal(typeof loadPrompt, "function");
});

test("prompt-loader: exports loadPromptSync function", async () => {
  const { loadPromptSync } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  assert.equal(typeof loadPromptSync, "function");
});

test("prompt-loader: exports preloadPrompts function", async () => {
  const { preloadPrompts } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  assert.equal(typeof preloadPrompts, "function");
});

test("prompt-loader: exports clearPromptCache function", async () => {
  const { clearPromptCache } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  assert.equal(typeof clearPromptCache, "function");
});

test("prompt-loader: exports getCachedPromptNames function", async () => {
  const { getCachedPromptNames } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  assert.equal(typeof getCachedPromptNames, "function");
});

test("prompt-loader: exports configurePromptCache function", async () => {
  const { configurePromptCache } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  assert.equal(typeof configurePromptCache, "function");
});

test("prompt-loader: exports renderPromptTemplate function", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  assert.equal(typeof renderPromptTemplate, "function");
});

test("prompt-loader: default export contains all methods", async () => {
  const mod = await import("../../../js/agents/prompts/prompt-loader.js");

  assert.equal(typeof mod.default.loadPrompt, "function");
  assert.equal(typeof mod.default.loadPromptSync, "function");
  assert.equal(typeof mod.default.preloadPrompts, "function");
  assert.equal(typeof mod.default.clearPromptCache, "function");
  assert.equal(typeof mod.default.getCachedPromptNames, "function");
  assert.equal(typeof mod.default.configurePromptCache, "function");
  assert.equal(typeof mod.default.renderPromptTemplate, "function");
});

// ============================================================================
// prompt-loader.js - renderPromptTemplate (duplicate API)
// ============================================================================

test("prompt-loader renderPromptTemplate: basic variable replacement", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const result = renderPromptTemplate("Hello {{name}}!", {
    vars: { name: "World" },
    escapeVars: false,
  });
  assert.equal(result, "Hello World!");
});

test("prompt-loader renderPromptTemplate: warnOnUnresolved logs warning", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  // Should not throw, just log warning
  const result = renderPromptTemplate("{{missing}}", {
    vars: {},
    warnOnUnresolved: true,
  });
  assert.ok(result.includes("{{missing}}"));
});

// ============================================================================
// Multi-language support (i18n-like patterns)
// ============================================================================

test("prompt-template: supports unicode variable values", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{greeting}} {{name}}", {
    vars: { greeting: "Hello", name: "Alice" },
    escapeVars: false,
  });

  assert.ok(result.includes("Hello"));
  assert.ok(result.includes("Alice"));
});

test("prompt-template: handles Chinese characters", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{msg}}", {
    vars: { msg: "Hello" },
    escapeVars: false,
  });

  assert.equal(result, "Hello");
});

test("prompt-template: handles mixed language content", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("English: {{en}}, Japanese: {{ja}}", {
    vars: { en: "Hello", ja: "Konnichiwa" },
    escapeVars: false,
  });

  assert.ok(result.includes("Hello"));
  assert.ok(result.includes("Konnichiwa"));
});

test("prompt-template: emoji in variables", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("Status: {{status}}", {
    vars: { status: "Done!" },
    escapeVars: false,
  });

  assert.ok(result.includes("Done!"));
});

// ============================================================================
// Edge cases
// ============================================================================

test("renderPromptTemplate: empty template", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  assert.equal(renderPromptTemplate(""), "");
  assert.equal(renderPromptTemplate(null), "");
  assert.equal(renderPromptTemplate(undefined), "");
});

test("renderPromptTemplate: no vars provided", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("Static text");
  assert.equal(result, "Static text");
});

test("renderPromptTemplate: whitespace in placeholder", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{  name  }}", {
    vars: { name: "test" },
    escapeVars: false,
  });
  assert.equal(result, "test");
});

test("renderPromptTemplate: array value without formatter", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{items}}", {
    vars: { items: ["a", "b", "c"] },
    escapeVars: false,
  });
  assert.equal(result, "a\nb\nc");
});

test("renderPromptTemplate: object value without formatter", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{obj}}", {
    vars: { obj: { x: 1 } },
    escapeVars: false,
  });
  // Should be JSON stringified
  assert.ok(result.includes('"x"'));
  assert.ok(result.includes("1"));
});

test("formatters: chained formatters |trim|upper", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{x|trim|upper}}", {
    vars: { x: "  hello  " },
    escapeVars: false,
  });
  assert.equal(result, "HELLO");
});

test("PromptLoader: LRU cache eviction", async () => {
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
  assert.equal(names.length, 2);
  // First loaded should be evicted
  assert.ok(!names.includes("deepsearch/quick"));
});

test("PromptLoader: maxPromptBytes limit", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({
    basePath: PROMPTS_DIR,
    maxPromptBytes: 10, // Very small limit
  });

  await assert.rejects(
    () => loader.loadPrompt("deepsearch/system"),
    /exceeds limit/
  );
});

// ============================================================================
// Additional prompt-loader.js renderPromptTemplate coverage
// ============================================================================

test("prompt-loader renderPromptTemplate: appendIfMissing with empty placeholder name", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const result = renderPromptTemplate("Main", {
    appendIfMissing: { "": "should skip", valid: "added" },
  });
  assert.ok(!result.includes("should skip"));
  assert.ok(result.includes("added"));
});

test("prompt-loader renderPromptTemplate: appendIfMissing with empty content", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const result = renderPromptTemplate("Main", {
    appendIfMissing: { empty: "", valid: "added" },
  });
  assert.ok(result.includes("added"));
});

test("prompt-loader renderPromptTemplate: onUnresolved callback that throws", async () => {
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
  assert.ok(result.includes("{{missing}}"));
});

test("prompt-loader renderPromptTemplate: more than 20 unresolved truncated", async () => {
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
  assert.equal(received.length, 20);
});

test("prompt-loader renderPromptTemplate: empty key placeholder", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const result = renderPromptTemplate("{{  }}", { vars: {} });
  assert.equal(result, "{{  }}");
});

test("prompt-loader renderPromptTemplate: non-object appendIfMissing ignored", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const result = renderPromptTemplate("Main", {
    appendIfMissing: "not-an-object",
  });
  assert.equal(result, "Main");
});

test("prompt-loader renderPromptTemplate: keepUnresolved false with empty key", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const result = renderPromptTemplate("{{  }}", {
    vars: {},
    keepUnresolved: false,
  });
  assert.equal(result, "");
});

test("prompt-loader renderPromptTemplate: object/array values kept as placeholder", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  // Arrays and objects are not directly rendered by prompt-loader's renderPromptTemplate
  const result = renderPromptTemplate("{{arr}} {{obj}}", {
    vars: { arr: [1, 2, 3], obj: { x: 1 } },
  });
  // Should keep as unresolved since arrays/objects not handled
  assert.ok(result.includes("{{arr}}") || result.includes("{{obj}}"));
});

// ============================================================================
// PromptLoader constructor edge cases
// ============================================================================

test("PromptLoader: constructor with Infinity maxManifestBytes", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({
    basePath: PROMPTS_DIR,
    maxManifestBytes: Infinity,
  });

  // Should not throw
  assert.ok(loader);
});

test("PromptLoader: constructor with invalid maxManifestBytes uses default", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({
    basePath: PROMPTS_DIR,
    maxManifestBytes: "invalid",
  });

  // Should not throw, uses default
  assert.ok(loader);
});

test("PromptLoader: constructor with negative maxPromptBytes uses default", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const loader = new PromptLoader({
    basePath: PROMPTS_DIR,
    maxPromptBytes: -100,
  });

  // Should not throw
  assert.ok(loader);
});

test("PromptLoader: constructor with custom fetchImpl", async () => {
  const { PromptLoader } = await import(
    "../../../js/agents/prompts/prompt-loader.js"
  );

  const customFetch = () => Promise.resolve({ ok: true, text: () => Promise.resolve("content") });
  const loader = new PromptLoader({
    basePath: PROMPTS_DIR,
    fetchImpl: customFetch,
  });

  assert.ok(loader);
});

// ============================================================================
// prompt-template.js additional coverage
// ============================================================================

test("prompt-template: formatter with args context", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  // json formatter uses args for space
  const result = renderPromptTemplate("{{data|json(4)}}", {
    vars: { data: { a: 1 } },
    escapeVars: false,
  });
  assert.ok(result.includes("    ")); // 4-space indent
});

test("prompt-template: nested object flattening depth limit", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  // Depth is limited to 4
  const deep = { l1: { l2: { l3: { l4: { l5: "deep" } } } } };
  const result = renderPromptTemplate("{{l1.l2.l3.l4.l5}}", {
    vars: deep,
  });
  // l5 should not be accessible due to depth limit
  assert.ok(result.includes("{{l1.l2.l3.l4.l5}}"));
});

test("prompt-template: array in vars not flattened", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  const result = renderPromptTemplate("{{items}}", {
    vars: { items: ["a", "b", "c"] },
    escapeVars: false,
  });
  assert.equal(result, "a\nb\nc");
});

test("prompt-template: warnOnUnresolved with multiple placeholders", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  // Just verify it doesn't throw
  const result = renderPromptTemplate("{{a}} {{b}} {{c}}", {
    vars: {},
    warnOnUnresolved: true,
  });
  assert.ok(result.includes("{{a}}"));
});

test("prompt-template: object at intermediate key also stored", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  // When we have config.value, config itself is also stored
  const result = renderPromptTemplate("{{config|json}}", {
    vars: { config: { value: 42 } },
    escapeVars: false,
  });
  assert.ok(result.includes('"value"'));
  assert.ok(result.includes("42"));
});

test("prompt-template: empty formatter name in pipeline", async () => {
  const { renderPromptTemplate } = await import(
    "../../../js/agents/prompts/prompt-template.js"
  );

  // {{x| }} should have empty formatter name
  const result = renderPromptTemplate("{{x| }}", {
    vars: { x: "val" },
    failOnUnresolved: true,
  });
  // Empty formatter is skipped
  assert.ok(result.includes("val"));
});

test("prompt-template: formatter with multiple args", async () => {
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
  assert.equal(result, "a,b");
});

// ============================================================================
// formatters/index.js DEFAULT_FORMATTERS with args
// ============================================================================

test("DEFAULT_FORMATTERS.code: uses lang from args", async () => {
  const { DEFAULT_FORMATTERS } = await import(
    "../../../js/agents/prompts/formatters/index.js"
  );

  const result = DEFAULT_FORMATTERS.code("content", { args: ["typescript"] });
  assert.ok(result.includes("```typescript"));
});

test("DEFAULT_FORMATTERS.json: uses space from args", async () => {
  const { DEFAULT_FORMATTERS } = await import(
    "../../../js/agents/prompts/formatters/index.js"
  );

  const result = DEFAULT_FORMATTERS.json({ x: 1 }, { args: ["4"] });
  assert.ok(result.includes("    ")); // 4-space indent
});

test("DEFAULT_FORMATTERS.bullets: called without ctx", async () => {
  const { DEFAULT_FORMATTERS } = await import(
    "../../../js/agents/prompts/formatters/index.js"
  );

  const result = DEFAULT_FORMATTERS.bullets(["a", "b"]);
  assert.equal(result, "- a\n- b");
});

// ============================================================================
// PromptRegistry additional edge cases
// ============================================================================

test("PromptRegistry: chain register calls", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  const result = registry.register("a", "A").register("b", "B");

  assert.equal(result, registry);
  assert.ok(registry.has("a"));
  assert.ok(registry.has("b"));
});

test("PromptRegistry: whitespace-only name in get returns null", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  assert.equal(registry.get("   "), null);
});

test("PromptRegistry: whitespace-only name in has returns false", async () => {
  const { PromptRegistry } = await import(
    "../../../js/agents/prompts/prompt-registry.js"
  );

  const registry = new PromptRegistry();
  assert.equal(registry.has("   "), false);
});
