import { describe, expect, it } from "vitest";

import {
  MessageRole,
  ModelHealth,
  ModelUsage,
  RouterStrategy,
  isValidMessageRole,
  isValidModelHealth,
  isValidModelUsage,
  isValidRouterStrategy,
  normalizeRouterStrategy,
} from '../../../../../js/agents/llm/constants.js';

describe("agents/llm/constants", () => {
  it("validates known enum values", () => {
    expect(isValidModelUsage(ModelUsage.WORKER)).toBe(true);
    expect(isValidModelUsage("bogus")).toBe(false);

    expect(isValidMessageRole(MessageRole.USER)).toBe(true);
    expect(isValidMessageRole("tool")).toBe(false);

    expect(isValidModelHealth(ModelHealth.HEALTHY)).toBe(true);
    expect(isValidModelHealth("offline")).toBe(false);

    expect(isValidRouterStrategy(RouterStrategy.ROUND_ROBIN)).toBe(true);
    expect(isValidRouterStrategy("nope")).toBe(false);
  });

  it("normalizeRouterStrategy() trims/normalizes and falls back", () => {
    expect(normalizeRouterStrategy(" PRIORITY ", "")).toBe(RouterStrategy.PRIORITY);
    expect(normalizeRouterStrategy("unknown", RouterStrategy.ROUND_ROBIN)).toBe(RouterStrategy.ROUND_ROBIN);
    // Non-string inputs should normalize to empty string and fall back.
    expect(normalizeRouterStrategy(123, RouterStrategy.PRIORITY)).toBe(RouterStrategy.PRIORITY);
  });

  it("covers additional enum values and fallbacks", () => {
    expect(isValidModelUsage(ModelUsage.ANALYST)).toBe(true);
    expect(isValidMessageRole(MessageRole.SYSTEM)).toBe(true);
    expect(normalizeRouterStrategy("unknown", RouterStrategy.PRIORITY)).toBe(RouterStrategy.PRIORITY);
  });
});
