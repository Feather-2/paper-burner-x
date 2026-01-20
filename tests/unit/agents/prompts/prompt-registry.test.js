import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/prompts/prompt-template.js", () => {
  const PromptTemplate = vi.fn(function PromptTemplate(template) {
    this.template = template;
    this.render = vi.fn(() => `rendered:${String(template)}`);
  });

  return { PromptTemplate };
});

import { PromptTemplate } from "../../../../js/agents/prompts/prompt-template.js";
import { PromptRegistry } from "../../../../js/agents/prompts/prompt-registry.js";

describe("PromptRegistry", () => {
  /** @type {PromptRegistry} */
  let registry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new PromptRegistry();
  });

  describe("register", () => {
    it("stores templates by trimmed name and returns registry", () => {
      const result = registry.register("  greet  ", "Hello {{name}}");

      expect(result).toBe(registry);
      expect(PromptTemplate).toHaveBeenCalledTimes(1);
      expect(PromptTemplate.mock.calls[0][0]).toBe("Hello {{name}}");
      expect(registry.has("greet")).toBe(true);
      expect(registry.get("greet")).toBe(PromptTemplate.mock.instances[0]);
    });

    it("accepts PromptTemplate instances without re-wrapping", () => {
      const tpl = new PromptTemplate("Hi {{name}}");
      const callsBefore = PromptTemplate.mock.calls.length;

      registry.register("hi", tpl);

      expect(PromptTemplate.mock.calls.length).toBe(callsBefore);
      expect(registry.get("hi")).toBe(tpl);
    });

    it("rejects invalid names including empty and whitespace", () => {
      expect(() => registry.register("", "A")).toThrow(/non-empty string/);
      expect(() => registry.register("   ", "A")).toThrow(/non-empty string/);
    });

    it("rejects non-string names at boundary values", () => {
      const invalidValues = [0, -1, Number.MAX_SAFE_INTEGER, null, undefined];
      for (const value of invalidValues) {
        expect(() => registry.register(value, "A")).toThrow(/non-empty string/);
      }
    });

    it("handles long names and large templates", () => {
      const longName = `name-${"x".repeat(10000)}`;
      const hugeTemplate = "y".repeat(200000);

      registry.register(longName, hugeTemplate);

      expect(registry.has(longName)).toBe(true);
      expect(PromptTemplate.mock.calls[0][0]).toBe(hugeTemplate);
      expect(PromptTemplate.mock.calls[0][0].length).toBe(hugeTemplate.length);
    });

    it("handles rapid consecutive re-registration", () => {
      for (let i = 0; i < 5; i += 1) {
        registry.register("repeat", `v${i}`);
      }

      expect(PromptTemplate).toHaveBeenCalledTimes(5);
      expect(registry.render("repeat")).toBe("rendered:v4");
      expect(registry.get("repeat")).toBe(PromptTemplate.mock.instances[4]);
    });
  });

  describe("registerMany", () => {
    it("supports object, array, and map inputs", () => {
      registry.registerMany({ a: "A", b: "B" });
      registry.registerMany([["c", "C"]]);
      registry.registerMany(new Map([["d", "D"]]));

      expect(registry.has("a")).toBe(true);
      expect(registry.has("b")).toBe(true);
      expect(registry.has("c")).toBe(true);
      expect(registry.has("d")).toBe(true);
      expect(PromptTemplate).toHaveBeenCalledTimes(4);
    });

    it("treats array-like objects as objects", () => {
      registry.registerMany({ 0: "zero", 1: "one" });

      expect(registry.has("0")).toBe(true);
      expect(registry.has("1")).toBe(true);
      expect(registry.list().length).toBe(2);
    });

    it("ignores empty inputs", () => {
      registry.registerMany([]);
      registry.registerMany({});
      registry.registerMany(new Map());

      expect(registry.list()).toEqual([]);
      expect(PromptTemplate).not.toHaveBeenCalled();
    });

    it("returns registry for falsy inputs including null/undefined/0", () => {
      expect(registry.registerMany(null)).toBe(registry);
      expect(registry.registerMany(undefined)).toBe(registry);
      expect(registry.registerMany(0)).toBe(registry);
      expect(registry.registerMany("")).toBe(registry);
      expect(registry.list()).toEqual([]);
    });

    it("throws on invalid types", () => {
      expect(() => registry.registerMany("bad")).toThrow(/object, array, or map/);
      expect(() => registry.registerMany(1)).toThrow(/object, array, or map/);
    });
  });

  describe("get", () => {
    it("returns stored template or null for unknown", () => {
      registry.register("a", "A");

      expect(registry.get("a")).toBe(PromptTemplate.mock.instances[0]);
      expect(registry.get("missing")).toBeNull();
    });

    it("handles non-string and empty names", () => {
      registry.register("a", "A");

      expect(registry.get("")).toBeNull();
      expect(registry.get("   ")).toBeNull();
      expect(registry.get(null)).toBeNull();
      expect(registry.get(undefined)).toBeNull();
      expect(registry.get(0)).toBeNull();
    });

    it("treats numeric string names as valid keys", () => {
      registry.register("123", "A");

      expect(registry.get("123")).toBe(PromptTemplate.mock.instances[0]);
      expect(registry.get(123)).toBeNull();
    });
  });

  describe("has", () => {
    it("checks existence with trimming", () => {
      registry.register("  key  ", "A");

      expect(registry.has("key")).toBe(true);
      expect(registry.has("  key ")).toBe(true);
    });

    it("returns false for non-string or empty names", () => {
      registry.register("x", "X");

      const invalidValues = ["", "   ", null, undefined, 0, -1];
      for (const value of invalidValues) {
        expect(registry.has(value)).toBe(false);
      }
    });
  });

  describe("list", () => {
    it("returns registered names", () => {
      registry.register(" a ", "A");
      registry.register("b", "B");

      expect(new Set(registry.list())).toEqual(new Set(["a", "b"]));
    });

    it("returns empty array when no templates are registered", () => {
      expect(registry.list()).toEqual([]);
    });
  });

  describe("clear", () => {
    it("removes a single template by name", () => {
      registry.registerMany({ a: "A", b: "B" });

      registry.clear("a");

      expect(registry.has("a")).toBe(false);
      expect(registry.has("b")).toBe(true);
    });

    it("clears all templates for whitespace names", () => {
      registry.registerMany({ a: "A", b: "B" });

      registry.clear("   ");

      expect(registry.list()).toEqual([]);
    });

    it("clears all templates for non-string names", () => {
      registry.registerMany({ a: "A", b: "B" });

      registry.clear(0);

      expect(registry.list()).toEqual([]);
    });
  });

  describe("render", () => {
    it("renders registered template and returns result", () => {
      registry.register("greet", "Hello {{name}}");
      const options = {
        vars: {
          user: {
            profile: {
              name: "Alice",
              meta: { id: 1, tags: ["a", "b", { nested: { value: "x" } }] },
            },
          },
        },
        keepUnresolved: false,
      };

      const instance = registry.get("greet");
      const result = registry.render("greet", options);

      expect(result).toBe("rendered:Hello {{name}}");
      expect(instance.render).toHaveBeenCalledTimes(1);
      expect(instance.render).toHaveBeenCalledWith(options);
    });

    it("throws for unknown prompt names", () => {
      expect(() => registry.render("missing")).toThrow(/unknown prompt/);
      expect(() => registry.render("")).toThrow(/unknown prompt/);
      expect(() => registry.render(undefined)).toThrow(/unknown prompt/);
    });
  });

  describe("concurrency", () => {
    it("handles concurrent registrations without losing entries", async () => {
      const names = Array.from({ length: 25 }, (_, i) => `t${i}`);

      await Promise.all(
        names.map((name) =>
          Promise.resolve().then(() => registry.register(name, name.toUpperCase()))
        )
      );

      expect(registry.list().length).toBe(names.length);
      for (const name of names) {
        expect(registry.has(name)).toBe(true);
      }
    });
  });
});
