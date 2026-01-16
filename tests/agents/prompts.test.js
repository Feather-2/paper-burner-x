import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { renderPromptTemplate, PromptTemplate } from "../../js/agents/prompts/prompt-template.js";
import { PromptRegistry } from "../../js/agents/prompts/prompt-registry.js";
import { DEFAULT_FORMATTERS, escapeTemplateDelimiters } from "../../js/agents/prompts/formatters/index.js";

describe("prompts/prompt-template", () => {
  describe("renderPromptTemplate", () => {
    it("replaces simple placeholders", () => {
      const result = renderPromptTemplate("Hello {{name}}!", { vars: { name: "World" } });
      assert.equal(result, "Hello World!");
    });

    it("handles case-insensitive placeholders", () => {
      const result = renderPromptTemplate("{{NAME}} {{Name}} {{name}}", { vars: { name: "test" } });
      assert.equal(result, "test test test");
    });

    it("supports dotted keys via object flattening", () => {
      const result = renderPromptTemplate("{{user.name}} is {{user.age}}", {
        vars: { user: { name: "Alice", age: 30 } },
      });
      assert.equal(result, "Alice is 30");
    });

    it("keeps unresolved placeholders when keepUnresolved=true", () => {
      const result = renderPromptTemplate("Hello {{unknown}}!", { keepUnresolved: true });
      assert.equal(result, "Hello {{unknown}}!");
    });

    it("removes unresolved placeholders when keepUnresolved=false", () => {
      const result = renderPromptTemplate("Hello {{unknown}}!", { keepUnresolved: false });
      assert.equal(result, "Hello !");
    });

    it("calls onUnresolved callback", () => {
      const unresolved = [];
      renderPromptTemplate("{{a}} {{b}}", {
        vars: { a: "A" },
        warnOnUnresolved: true,
        onUnresolved: (names) => unresolved.push(...names),
      });
      assert.deepEqual(unresolved, ["b"]);
    });

    it("throws when failOnUnresolved=true", () => {
      assert.throws(
        () => renderPromptTemplate("{{missing}}", { failOnUnresolved: true }),
        /Unresolved placeholders/
      );
    });

    it("appends content via appendIfMissing", () => {
      const result = renderPromptTemplate("Main content", {
        appendIfMissing: { extra: "Extra section" },
      });
      assert.ok(result.includes("Main content"));
      assert.ok(result.includes("Extra section"));
    });

    it("does not append if placeholder exists", () => {
      const result = renderPromptTemplate("Has {{extra}} here", {
        vars: { extra: "content" },
        appendIfMissing: { extra: "Should not appear" },
      });
      assert.ok(!result.includes("Should not appear"));
    });

    it("handles array values", () => {
      const result = renderPromptTemplate("Items: {{items}}", {
        vars: { items: ["a", "b", "c"] },
      });
      assert.ok(result.includes("a"));
      assert.ok(result.includes("b"));
      assert.ok(result.includes("c"));
    });

    it("handles object values with JSON stringify", () => {
      const result = renderPromptTemplate("Data: {{data}}", {
        vars: { data: { key: "value" } },
      });
      assert.ok(result.includes("key"));
      assert.ok(result.includes("value"));
    });

    it("handles null and undefined values", () => {
      const result = renderPromptTemplate("{{a}} {{b}}", {
        vars: { a: null, b: undefined },
        keepUnresolved: false,
      });
      assert.equal(result.trim(), "");
    });

    it("handles boolean and number values", () => {
      const result = renderPromptTemplate("{{bool}} {{num}}", {
        vars: { bool: true, num: 42 },
      });
      assert.equal(result, "true 42");
    });

    it("accepts Map as vars", () => {
      const vars = new Map([["key", "value"]]);
      const result = renderPromptTemplate("{{key}}", { vars });
      assert.equal(result, "value");
    });
  });

  describe("formatter pipeline", () => {
    it("applies json formatter", () => {
      const result = renderPromptTemplate("{{data|json}}", {
        vars: { data: { a: 1 } },
      });
      assert.ok(result.includes('"a"'));
    });

    it("applies bullets formatter", () => {
      const result = renderPromptTemplate("{{items|bullets}}", {
        vars: { items: ["one", "two"] },
      });
      assert.ok(result.includes("- one") || result.includes("• one"));
    });

    it("applies trim formatter", () => {
      const result = renderPromptTemplate("{{text|trim}}", {
        vars: { text: "  spaced  " },
      });
      assert.equal(result, "spaced");
    });

    it("applies upper formatter", () => {
      const result = renderPromptTemplate("{{text|upper}}", {
        vars: { text: "hello" },
      });
      assert.equal(result, "HELLO");
    });

    it("chains multiple formatters", () => {
      const result = renderPromptTemplate("{{text|trim|upper}}", {
        vars: { text: "  hello  " },
      });
      assert.equal(result, "HELLO");
    });

    it("marks unknown formatter as unresolved", () => {
      const unresolved = [];
      renderPromptTemplate("{{text|unknownFormatter}}", {
        vars: { text: "hello" },
        warnOnUnresolved: true,
        onUnresolved: (names) => unresolved.push(...names),
      });
      assert.ok(unresolved.some((u) => u.includes("unknownFormatter")));
    });

    it("supports custom formatters", () => {
      const result = renderPromptTemplate("{{text|reverse}}", {
        vars: { text: "hello" },
        formatters: {
          reverse: (v) => String(v).split("").reverse().join(""),
        },
      });
      assert.equal(result, "olleh");
    });

    it("passes args to formatters", () => {
      const result = renderPromptTemplate("{{items|lines}}", {
        vars: { items: ["a", "b", "c"] },
      });
      assert.ok(result.includes("a"));
      assert.ok(result.includes("b"));
    });
  });

  describe("escapeTemplateDelimiters", () => {
    it("escapes {{ and }}", () => {
      const escaped = escapeTemplateDelimiters("Use {{var}} here");
      assert.ok(!escaped.includes("{{"));
    });
  });

  describe("PromptTemplate class", () => {
    it("creates template from string", () => {
      const tpl = new PromptTemplate("Hello {{name}}!");
      const result = tpl.render({ vars: { name: "Test" } });
      assert.equal(result, "Hello Test!");
    });

    it("handles non-string input", () => {
      const tpl = new PromptTemplate(null);
      assert.equal(tpl.template, "");
    });
  });
});

describe("prompts/prompt-registry", () => {
  describe("register and get", () => {
    it("registers and retrieves template", () => {
      const registry = new PromptRegistry();
      registry.register("greeting", "Hello {{name}}!");
      const tpl = registry.get("greeting");
      assert.ok(tpl instanceof PromptTemplate);
    });

    it("throws on empty name", () => {
      const registry = new PromptRegistry();
      assert.throws(() => registry.register("", "template"), /non-empty string/);
    });

    it("accepts PromptTemplate instance", () => {
      const registry = new PromptRegistry();
      const tpl = new PromptTemplate("Test");
      registry.register("test", tpl);
      assert.equal(registry.get("test"), tpl);
    });

    it("returns null for unknown template", () => {
      const registry = new PromptRegistry();
      assert.equal(registry.get("unknown"), null);
    });
  });

  describe("registerMany", () => {
    it("registers from object", () => {
      const registry = new PromptRegistry();
      registry.registerMany({ a: "Template A", b: "Template B" });
      assert.ok(registry.has("a"));
      assert.ok(registry.has("b"));
    });

    it("registers from array", () => {
      const registry = new PromptRegistry();
      registry.registerMany([["x", "X"], ["y", "Y"]]);
      assert.ok(registry.has("x"));
      assert.ok(registry.has("y"));
    });

    it("registers from Map", () => {
      const registry = new PromptRegistry();
      const map = new Map([["m", "M"]]);
      registry.registerMany(map);
      assert.ok(registry.has("m"));
    });

    it("handles null gracefully", () => {
      const registry = new PromptRegistry();
      registry.registerMany(null);
      assert.equal(registry.list().length, 0);
    });

    it("throws on invalid input", () => {
      const registry = new PromptRegistry();
      assert.throws(() => registry.registerMany("invalid"));
    });
  });

  describe("has and list", () => {
    it("has returns true for existing", () => {
      const registry = new PromptRegistry();
      registry.register("test", "Test");
      assert.equal(registry.has("test"), true);
      assert.equal(registry.has("other"), false);
    });

    it("list returns all names", () => {
      const registry = new PromptRegistry();
      registry.register("a", "A");
      registry.register("b", "B");
      const names = registry.list();
      assert.ok(names.includes("a"));
      assert.ok(names.includes("b"));
    });
  });

  describe("clear", () => {
    it("clears specific template", () => {
      const registry = new PromptRegistry();
      registry.register("a", "A");
      registry.register("b", "B");
      registry.clear("a");
      assert.equal(registry.has("a"), false);
      assert.equal(registry.has("b"), true);
    });

    it("clears all templates", () => {
      const registry = new PromptRegistry();
      registry.register("a", "A");
      registry.register("b", "B");
      registry.clear();
      assert.equal(registry.list().length, 0);
    });
  });

  describe("render", () => {
    it("renders registered template", () => {
      const registry = new PromptRegistry();
      registry.register("greet", "Hello {{name}}!");
      const result = registry.render("greet", { vars: { name: "World" } });
      assert.equal(result, "Hello World!");
    });

    it("throws for unknown template", () => {
      const registry = new PromptRegistry();
      assert.throws(() => registry.render("unknown"), /unknown prompt/);
    });
  });
});

describe("prompts/formatters", () => {
  it("exports default formatters", () => {
    assert.ok(typeof DEFAULT_FORMATTERS.json === "function");
    assert.ok(typeof DEFAULT_FORMATTERS.bullets === "function");
    assert.ok(typeof DEFAULT_FORMATTERS.trim === "function");
    assert.ok(typeof DEFAULT_FORMATTERS.upper === "function");
    assert.ok(typeof DEFAULT_FORMATTERS.lines === "function");
    assert.ok(typeof DEFAULT_FORMATTERS.code === "function");
  });

  it("json formats object", () => {
    const result = DEFAULT_FORMATTERS.json({ key: "value" });
    assert.ok(result.includes("key"));
  });

  it("bullets formats array", () => {
    const result = DEFAULT_FORMATTERS.bullets(["a", "b"]);
    assert.ok(result.includes("a"));
    assert.ok(result.includes("b"));
  });

  it("code wraps in code block", () => {
    const result = DEFAULT_FORMATTERS.code("const x = 1;", { args: ["js"] });
    assert.ok(result.includes("```"));
    assert.ok(result.includes("const x = 1;"));
  });
});
