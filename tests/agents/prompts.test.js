
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { renderPromptTemplate, PromptTemplate } from "../../js/agents/prompts/prompt-template.js";
import { PromptRegistry } from "../../js/agents/prompts/prompt-registry.js";
import { DEFAULT_FORMATTERS, escapeTemplateDelimiters } from "../../js/agents/prompts/formatters/index.js";

describe("prompts/prompt-template", () => {
  describe("renderPromptTemplate", () => {
    it("replaces simple placeholders", () => {
      const result = renderPromptTemplate("Hello {{name}}!", { vars: { name: "World" } });
      expect(result).toBe("Hello World!");
    });

    it("handles case-insensitive placeholders", () => {
      const result = renderPromptTemplate("{{NAME}} {{Name}} {{name}}", { vars: { name: "test" } });
      expect(result).toBe("test test test");
    });

    it("supports dotted keys via object flattening", () => {
      const result = renderPromptTemplate("{{user.name}} is {{user.age}}", {
        vars: { user: { name: "Alice", age: 30 } },
      });
      expect(result).toBe("Alice is 30");
    });

    it("keeps unresolved placeholders when keepUnresolved=true", () => {
      const result = renderPromptTemplate("Hello {{unknown}}!", { keepUnresolved: true });
      expect(result).toBe("Hello {{unknown}}!");
    });

    it("removes unresolved placeholders when keepUnresolved=false", () => {
      const result = renderPromptTemplate("Hello {{unknown}}!", { keepUnresolved: false });
      expect(result).toBe("Hello !");
    });

    it("calls onUnresolved callback", () => {
      const unresolved = [];
      renderPromptTemplate("{{a}} {{b}}", {
        vars: { a: "A" },
        warnOnUnresolved: true,
        onUnresolved: (names) => unresolved.push(...names),
      });
      expect(unresolved).toEqual(["b"]);
    });

    it("throws when failOnUnresolved=true", () => {
      expect(() => renderPromptTemplate("{{missing}}", { failOnUnresolved: true })).toThrow(/Unresolved placeholders/);
    });

    it("appends content via appendIfMissing", () => {
      const result = renderPromptTemplate("Main content", {
        appendIfMissing: { extra: "Extra section" },
      });
      expect(result.includes("Main content")).toBeTruthy();
      expect(result.includes("Extra section")).toBeTruthy();
    });

    it("does not append if placeholder exists", () => {
      const result = renderPromptTemplate("Has {{extra}} here", {
        vars: { extra: "content" },
        appendIfMissing: { extra: "Should not appear" },
      });
      expect(!result.includes("Should not appear")).toBeTruthy();
    });

    it("handles array values", () => {
      const result = renderPromptTemplate("Items: {{items}}", {
        vars: { items: ["a", "b", "c"] },
      });
      expect(result.includes("a")).toBeTruthy();
      expect(result.includes("b")).toBeTruthy();
      expect(result.includes("c")).toBeTruthy();
    });

    it("handles object values with JSON stringify", () => {
      const result = renderPromptTemplate("Data: {{data}}", {
        vars: { data: { key: "value" } },
      });
      expect(result.includes("key")).toBeTruthy();
      expect(result.includes("value")).toBeTruthy();
    });

    it("handles null and undefined values", () => {
      const result = renderPromptTemplate("{{a}} {{b}}", {
        vars: { a: null, b: undefined },
        keepUnresolved: false,
      });
      expect(result.trim()).toBe("");
    });

    it("handles boolean and number values", () => {
      const result = renderPromptTemplate("{{bool}} {{num}}", {
        vars: { bool: true, num: 42 },
      });
      expect(result).toBe("true 42");
    });

    it("accepts Map as vars", () => {
      const vars = new Map([["key", "value"]]);
      const result = renderPromptTemplate("{{key}}", { vars });
      expect(result).toBe("value");
    });
  });

  describe("formatter pipeline", () => {
    it("applies json formatter", () => {
      const result = renderPromptTemplate("{{data|json}}", {
        vars: { data: { a: 1 } },
      });
      expect(result.includes('"a"')).toBeTruthy();
    });

    it("applies bullets formatter", () => {
      const result = renderPromptTemplate("{{items|bullets}}", {
        vars: { items: ["one", "two"] },
      });
      expect(result.includes("- one") || result.includes("• one").toBeTruthy());
    });

    it("applies trim formatter", () => {
      const result = renderPromptTemplate("{{text|trim}}", {
        vars: { text: "  spaced  " },
      });
      expect(result).toBe("spaced");
    });

    it("applies upper formatter", () => {
      const result = renderPromptTemplate("{{text|upper}}", {
        vars: { text: "hello" },
      });
      expect(result).toBe("HELLO");
    });

    it("chains multiple formatters", () => {
      const result = renderPromptTemplate("{{text|trim|upper}}", {
        vars: { text: "  hello  " },
      });
      expect(result).toBe("HELLO");
    });

    it("marks unknown formatter as unresolved", () => {
      const unresolved = [];
      renderPromptTemplate("{{text|unknownFormatter}}", {
        vars: { text: "hello" },
        warnOnUnresolved: true,
        onUnresolved: (names) => unresolved.push(...names),
      });
      expect(unresolved.some(u => u.includes("unknownFormatter")));
    });

    it("supports custom formatters", () => {
      const result = renderPromptTemplate("{{text|reverse}}", {
        vars: { text: "hello" },
        formatters: {
          reverse: (v) => String(v).split("").reverse().join(""),
        },
      });
      expect(result).toBe("olleh");
    });

    it("passes args to formatters", () => {
      const result = renderPromptTemplate("{{items|lines}}", {
        vars: { items: ["a", "b", "c"] },
      });
      expect(result.includes("a")).toBeTruthy();
      expect(result.includes("b")).toBeTruthy();
    });
  });

  describe("escapeTemplateDelimiters", () => {
    it("escapes {{ and }}", () => {
      const escaped = escapeTemplateDelimiters("Use {{var}} here");
      expect(!escaped.includes("{{")).toBeTruthy();
    });
  });

  describe("PromptTemplate class", () => {
    it("creates template from string", () => {
      const tpl = new PromptTemplate("Hello {{name}}!");
      const result = tpl.render({ vars: { name: "Test" } });
      expect(result).toBe("Hello Test!");
    });

    it("handles non-string input", () => {
      const tpl = new PromptTemplate(null);
      expect(tpl.template).toBe("");
    });
  });
});

describe("prompts/prompt-registry", () => {
  describe("register and get", () => {
    it("registers and retrieves template", () => {
      const registry = new PromptRegistry();
      registry.register("greeting", "Hello {{name}}!");
      const tpl = registry.get("greeting");
      expect(tpl instanceof PromptTemplate).toBeTruthy();
    });

    it("throws on empty name", () => {
      const registry = new PromptRegistry();
      expect(() => registry.register("", "template")).toThrow(/non-empty string/);
    });

    it("accepts PromptTemplate instance", () => {
      const registry = new PromptRegistry();
      const tpl = new PromptTemplate("Test");
      registry.register("test", tpl);
      expect(registry.get("test")).toBe(tpl);
    });

    it("returns null for unknown template", () => {
      const registry = new PromptRegistry();
      expect(registry.get("unknown")).toBe(null);
    });
  });

  describe("registerMany", () => {
    it("registers from object", () => {
      const registry = new PromptRegistry();
      registry.registerMany({ a: "Template A", b: "Template B" });
      expect(registry.has("a")).toBeTruthy();
      expect(registry.has("b")).toBeTruthy();
    });

    it("registers from array", () => {
      const registry = new PromptRegistry();
      registry.registerMany([["x", "X"], ["y", "Y"]]);
      expect(registry.has("x")).toBeTruthy();
      expect(registry.has("y")).toBeTruthy();
    });

    it("registers from Map", () => {
      const registry = new PromptRegistry();
      const map = new Map([["m", "M"]]);
      registry.registerMany(map);
      expect(registry.has("m")).toBeTruthy();
    });

    it("handles null gracefully", () => {
      const registry = new PromptRegistry();
      registry.registerMany(null);
      expect(registry.list().length).toBe(0);
    });

    it("throws on invalid input", () => {
      const registry = new PromptRegistry();
      expect(() => registry.registerMany("invalid").toThrow());
    });
  });

  describe("has and list", () => {
    it("has returns true for existing", () => {
      const registry = new PromptRegistry();
      registry.register("test", "Test");
      expect(registry.has("test")).toBe(true);
      expect(registry.has("other")).toBe(false);
    });

    it("list returns all names", () => {
      const registry = new PromptRegistry();
      registry.register("a", "A");
      registry.register("b", "B");
      const names = registry.list();
      expect(names.includes("a")).toBeTruthy();
      expect(names.includes("b")).toBeTruthy();
    });
  });

  describe("clear", () => {
    it("clears specific template", () => {
      const registry = new PromptRegistry();
      registry.register("a", "A");
      registry.register("b", "B");
      registry.clear("a");
      expect(registry.has("a")).toBe(false);
      expect(registry.has("b")).toBe(true);
    });

    it("clears all templates", () => {
      const registry = new PromptRegistry();
      registry.register("a", "A");
      registry.register("b", "B");
      registry.clear();
      expect(registry.list().length).toBe(0);
    });
  });

  describe("render", () => {
    it("renders registered template", () => {
      const registry = new PromptRegistry();
      registry.register("greet", "Hello {{name}}!");
      const result = registry.render("greet", { vars: { name: "World" } });
      expect(result).toBe("Hello World!");
    });

    it("throws for unknown template", () => {
      const registry = new PromptRegistry();
      expect(() => registry.render("unknown")).toThrow(/unknown prompt/);
    });
  });
});

describe("prompts/formatters", () => {
  it("exports default formatters", () => {
    expect(typeof DEFAULT_FORMATTERS.json === "function").toBeTruthy();
    expect(typeof DEFAULT_FORMATTERS.bullets === "function").toBeTruthy();
    expect(typeof DEFAULT_FORMATTERS.trim === "function").toBeTruthy();
    expect(typeof DEFAULT_FORMATTERS.upper === "function").toBeTruthy();
    expect(typeof DEFAULT_FORMATTERS.lines === "function").toBeTruthy();
    expect(typeof DEFAULT_FORMATTERS.code === "function").toBeTruthy();
  });

  it("json formats object", () => {
    const result = DEFAULT_FORMATTERS.json({ key: "value" });
    expect(result.includes("key")).toBeTruthy();
  });

  it("bullets formats array", () => {
    const result = DEFAULT_FORMATTERS.bullets(["a", "b"]);
    expect(result.includes("a")).toBeTruthy();
    expect(result.includes("b")).toBeTruthy();
  });

  it("code wraps in code block", () => {
    const result = DEFAULT_FORMATTERS.code("const x = 1;", { args: ["js"] });
    expect(result.includes("```")).toBeTruthy();
    expect(result.includes("const x = 1;")).toBeTruthy();
  });
});
