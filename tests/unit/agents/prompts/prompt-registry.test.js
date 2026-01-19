import { describe, it, expect } from "vitest";

import { PromptTemplate } from '../../../../js/agents/prompts/prompt-template.js';
import { PromptRegistry } from '../../../../js/agents/prompts/prompt-registry.js';

describe("agents/prompts/prompt-registry.js", () => {
  it("registers templates and renders them", () => {
    const reg = new PromptRegistry();
    reg.register("greet", "Hello {{name}}");

    expect(reg.render("greet", { vars: { name: "Alice" }, keepUnresolved: false })).toBe("Hello Alice");
  });

  it("accepts PromptTemplate instances", () => {
    const reg = new PromptRegistry();
    reg.register("hi", new PromptTemplate("Hi {{name|upper}}"));

    expect(reg.render("hi", { vars: { name: "alice" }, keepUnresolved: false })).toBe("Hi ALICE");
  });

  it("registerMany supports object/array/map", () => {
    const reg = new PromptRegistry();

    reg.registerMany({ a: "A", b: "B" });
    expect(reg.has("a")).toBe(true);

    reg.registerMany([["c", "C"]]);
    expect(reg.has("c")).toBe(true);

    reg.registerMany(new Map([["d", "D"]]));
    expect(reg.has("d")).toBe(true);
  });

  it("get/list/clear work as expected", () => {
    const reg = new PromptRegistry();
    reg.registerMany({ a: "A", b: "B" });

    expect(reg.get("a")).toBeInstanceOf(PromptTemplate);
    expect(new Set(reg.list())).toEqual(new Set(["a", "b"]));

    reg.clear("a");
    expect(reg.has("a")).toBe(false);
    expect(reg.has("b")).toBe(true);

    reg.clear();
    expect(reg.list()).toEqual([]);
  });

  it("handles non-string lookups and empty registerMany gracefully", () => {
    const reg = new PromptRegistry();
    expect(reg.registerMany(null)).toBe(reg);
    expect(reg.get(123)).toBeNull();
    expect(reg.has(undefined)).toBe(false);
  });

  it("throws on invalid inputs and unknown prompts", () => {
    const reg = new PromptRegistry();
    expect(() => reg.register("", "x")).toThrow(/non-empty string/);
    expect(() => reg.register(123, "x")).toThrow(/non-empty string/);
    expect(() => reg.registerMany(123)).toThrow(/object, array, or map/);
    expect(() => reg.render("missing", { vars: {} })).toThrow(/unknown prompt/);
  });
});
