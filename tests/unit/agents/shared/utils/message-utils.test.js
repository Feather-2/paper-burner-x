import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/shared/utils/value-utils.js", () => ({
  toNonEmptyString: vi.fn(),
}));

import { injectSystemHint } from "../../../../../js/agents/shared/utils/message-utils.js";
import { toNonEmptyString } from "../../../../../js/agents/shared/utils/value-utils.js";

const mockedToNonEmptyString = vi.mocked(toNonEmptyString);

beforeEach(() => {
  mockedToNonEmptyString.mockReset();
});

describe("injectSystemHint", () => {
  it("returns cloned list and skips insertion for empty hints", () => {
    const messages = [
      { role: "user", content: "hello" },
      null,
      "raw",
      { role: "assistant", content: "ok" },
    ];
    const originalFirst = messages[0];
    const originalLast = messages[3];
    const hints = [null, undefined, "", "   \t\n"];

    hints.forEach((hint) => {
      mockedToNonEmptyString.mockReturnValueOnce("");
      const result = injectSystemHint(messages, hint);

      expect(result).toHaveLength(messages.length);
      expect(result).not.toBe(messages);
      expect(result[0]).not.toBe(originalFirst);
      expect(result[3]).not.toBe(originalLast);
      expect(result.some((msg) => msg && typeof msg === "object" && msg.role === "system")).toBe(false);
    });

    expect(mockedToNonEmptyString).toHaveBeenCalledTimes(hints.length);
    hints.forEach((hint, index) => {
      expect(mockedToNonEmptyString).toHaveBeenNthCalledWith(index + 1, hint);
    });
    expect(messages[0]).toBe(originalFirst);
    expect(messages[3]).toBe(originalLast);
  });

  it("inserts hint into empty or invalid message lists", () => {
    const emptyArray = [];
    const cases = [null, undefined, emptyArray, {}, { length: 2, 0: { role: "user", content: "x" } }];

    cases.forEach((messages) => {
      mockedToNonEmptyString.mockReturnValueOnce("hint");
      const result = injectSystemHint(messages, "hint");
      expect(result).toEqual([{ role: "system", content: "hint" }]);
    });

    expect(emptyArray).toHaveLength(0);
    expect(mockedToNonEmptyString).toHaveBeenCalledTimes(cases.length);
  });

  it("avoids duplicate system hints when content already includes text", () => {
    const cases = [
      { role: "system", content: "prefix 0 suffix" },
      { role: "system", content: 0 },
    ];

    cases.forEach((systemMsg) => {
      const messages = [systemMsg, { role: "assistant", content: "ok" }];
      mockedToNonEmptyString.mockReturnValueOnce("0");
      const result = injectSystemHint(messages, 0);

      expect(result).toHaveLength(2);
      expect(result.filter((msg) => msg && typeof msg === "object" && msg.role === "system")).toHaveLength(1);
      expect(result[0]).not.toBe(systemMsg);
    });

    expect(mockedToNonEmptyString).toHaveBeenCalledTimes(cases.length);
  });

  it("inserts hint before the last user message", () => {
    const messages = [
      { role: "system", content: "sys" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a2" },
    ];

    mockedToNonEmptyString.mockReturnValue("hint");
    const result = injectSystemHint(messages, "hint");

    expect(result).toHaveLength(messages.length + 1);
    expect(result[2]).toEqual({ role: "system", content: "hint" });
    expect(result.map((msg) => (msg && typeof msg === "object" ? msg.role : msg))).toEqual([
      "system",
      "assistant",
      "system",
      "user",
      "assistant",
    ]);
    expect(result[0]).not.toBe(messages[0]);
    expect(messages[2].role).toBe("user");
  });

  it("inserts hint before the last tool message", () => {
    const messages = [
      { role: "assistant", content: "a1" },
      { role: "tool", content: "t1" },
      { role: "assistant", content: "a2" },
    ];

    mockedToNonEmptyString.mockReturnValue("tool-hint");
    const result = injectSystemHint(messages, "tool-hint");

    expect(result).toHaveLength(4);
    expect(result[1]).toEqual({ role: "system", content: "tool-hint" });
    expect(result[2]).toEqual({ role: "tool", content: "t1" });
  });

  it("appends when no user/tool and preserves non-object entries", () => {
    const messages = ["raw", 123, { role: "assistant", content: "a" }];

    mockedToNonEmptyString.mockReturnValue("-1");
    const result = injectSystemHint(messages, -1);

    expect(result).toHaveLength(4);
    expect(result[0]).toBe("raw");
    expect(result[1]).toBe(123);
    expect(result[2]).not.toBe(messages[2]);
    expect(result[3]).toEqual({ role: "system", content: "-1" });
    expect(() => injectSystemHint([null, 0, undefined], -1)).not.toThrow();
  });

  it("accepts numeric string hints and MAX_SAFE_INTEGER", () => {
    const cases = [
      { hint: "123", text: "123" },
      { hint: Number.MAX_SAFE_INTEGER, text: String(Number.MAX_SAFE_INTEGER) },
    ];

    cases.forEach(({ hint, text }) => {
      const messages = [{ role: "user", content: "u" }];
      mockedToNonEmptyString.mockReturnValueOnce(text);
      const result = injectSystemHint(messages, hint);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ role: "system", content: text });
      expect(result[1]).toEqual({ role: "user", content: "u" });
    });
  });

  it("handles concurrent and rapid successive calls independently", async () => {
    const messages = [
      { role: "assistant", content: "a" },
      { role: "user", content: "u" },
    ];

    mockedToNonEmptyString.mockReturnValue("hint");
    const results = await Promise.all(
      Array.from({ length: 5 }, () => Promise.resolve(injectSystemHint(messages, "hint")))
    );

    expect(results).toHaveLength(5);
    expect(new Set(results).size).toBe(5);
    results.forEach((result) => {
      expect(result).toHaveLength(3);
      expect(result[1]).toEqual({ role: "system", content: "hint" });
    });

    const quick1 = injectSystemHint(messages, "hint");
    const quick2 = injectSystemHint(messages, "hint");
    expect(quick1).not.toBe(quick2);
    expect(mockedToNonEmptyString).toHaveBeenCalledTimes(7);
  });

  it("handles large inputs, long hints, and deep nesting", () => {
    const longHint = "h".repeat(10000);
    const deepContent = { level1: { level2: { level3: { level4: { level5: "value" } } } } };

    const largeMessages = Array.from({ length: 5000 }, (_, i) => ({
      role: "assistant",
      content: { index: i },
    }));
    largeMessages.unshift({ role: "assistant", content: deepContent });
    largeMessages.push({ role: "user", content: deepContent });

    mockedToNonEmptyString.mockReturnValue(longHint);
    const result = injectSystemHint(largeMessages, longHint);

    expect(result).toHaveLength(largeMessages.length + 1);
    const insertIndex = result.findIndex(
      (msg) => msg && typeof msg === "object" && msg.role === "system" && msg.content === longHint
    );
    expect(insertIndex).toBe(largeMessages.length - 1);
    expect(largeMessages[largeMessages.length - 1].role).toBe("user");
  });
});
