import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/runtime/safety/command-classifier.js", () => ({
  parseCompoundCommand: vi.fn(),
  __internal: {
    hasCommandSubstitution: vi.fn(),
  },
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  toNonEmptyString: vi.fn((value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  }),
}));

import {
  normalizeToolRestrictions,
  evaluateToolRestrictions,
} from "../../../../../js/agents/runtime/safety/tool-restrictions.js";
import {
  parseCompoundCommand,
  __internal,
} from "../../../../../js/agents/runtime/safety/command-classifier.js";

beforeEach(() => {
  vi.clearAllMocks();
  parseCompoundCommand.mockReturnValue([]);
  __internal.hasCommandSubstitution.mockReturnValue(false);
});

describe("normalizeToolRestrictions", () => {
  it("returns null for nullish and non-object inputs", () => {
    const samples = [null, undefined, false, 0, -1, Number.MAX_SAFE_INTEGER, "", " ", "tool"];

    for (const sample of samples) {
      expect(normalizeToolRestrictions(sample)).toBe(null);
    }
  });

  it("returns null for empty objects or lists", () => {
    expect(normalizeToolRestrictions({})).toBe(null);
    expect(normalizeToolRestrictions([])).toBe(null);
    expect(normalizeToolRestrictions({ allowedTools: [], blockedTools: [], bash: {} })).toBe(null);
  });

  it("normalizes tool allow/block lists and bash tool names", () => {
    const raw = {
      allowedTools: "read, write\nedit",
      blockedTools: ["delete", null, "", "EXECUTE"],
      bash: {
        allowedCommands: ["ls", "cat"],
        blockedCommands: "rm, sudo\nshutdown",
        toolNames: ["BASH", "ZSH", ""],
      },
    };

    const normalized = normalizeToolRestrictions(raw);

    expect(normalized.allowedTools).toEqual(["read", "write", "edit"]);
    expect(normalized.blockedTools).toEqual(["delete", "EXECUTE"]);
    expect(normalized.bash.allowedCommands).toEqual(["ls", "cat"]);
    expect(normalized.bash.blockedCommands).toEqual(["rm", "sudo", "shutdown"]);
    expect(normalized.bash.toolNames).toEqual(["bash", "zsh"]);
  });

  it("defaults bash toolNames when commands are provided", () => {
    const normalized = normalizeToolRestrictions({
      bash: {
        blockedCommands: ["rm -rf /"],
      },
    });

    expect(normalized.bash.toolNames).toEqual(["bash"]);
  });

  it("handles long strings and deep nesting", () => {
    const longTool = "a".repeat(10000);
    const normalized = normalizeToolRestrictions({
      allowedTools: longTool,
      bash: {
        toolNames: ["BASH"],
        nested: { a: { b: { c: "value" } } },
      },
    });

    expect(normalized.allowedTools).toEqual([longTool]);
    expect(normalized.bash.toolNames).toEqual(["bash"]);
  });

  it("ignores invalid list types", () => {
    const normalized = normalizeToolRestrictions({
      allowedTools: { 0: "read" },
      blockedTools: 123,
      bash: {
        allowedCommands: { a: 1 },
        blockedCommands: { b: 2 },
        toolNames: [""],
      },
    });

    expect(normalized).toBe(null);
  });
});

describe("evaluateToolRestrictions", () => {
  it("allows when restrictions are nullish or empty", () => {
    const inputs = [undefined, null, false, {}, []];

    for (const restrictions of inputs) {
      const result = evaluateToolRestrictions({ toolName: "read", restrictions });
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks tools not in allowlist (allowlist takes precedence over blocklist)", () => {
    const result = evaluateToolRestrictions({
      toolName: "WRITE",
      restrictions: {
        allowedTools: ["read"],
        blockedTools: ["write"],
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("tool_not_allowed");
    expect(result.policy).toEqual({ type: "allowlist", tool: "write" });
  });

  it("allows wildcard tool patterns", () => {
    const result = evaluateToolRestrictions({
      toolName: "READ",
      restrictions: {
        allowedTools: ["re?d", "tool*"],
      },
    });

    expect(result.allowed).toBe(true);
  });

  it("blocks tool patterns matched by regex blocklist", () => {
    const result = evaluateToolRestrictions({
      toolName: "WRITE",
      restrictions: {
        blockedTools: [/^wr/i],
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("tool_blocked");
    expect(result.policy).toEqual({ type: "blocklist", tool: "write" });
  });

  it("blocks when bash command substitution is detected", () => {
    __internal.hasCommandSubstitution.mockReturnValue(true);

    const result = evaluateToolRestrictions({
      toolName: "BASH",
      command: "echo $(pwd)",
      restrictions: {
        bash: {
          toolNames: ["bash"],
          allowedCommands: ["echo"],
        },
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("command_substitution");
    expect(result.policy).toEqual({ type: "bash", tool: "bash" });
  });

  it("blocks when parsed commands are empty and allowlist exists", () => {
    parseCompoundCommand.mockReturnValue([]);

    const result = evaluateToolRestrictions({
      toolName: "bash",
      command: [],
      restrictions: {
        bash: { allowedCommands: ["ls"] },
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("command_not_allowed");
  });

  it("allows when parsed commands are empty and no allowlist exists", () => {
    parseCompoundCommand.mockReturnValue([]);

    const result = evaluateToolRestrictions({
      toolName: "bash",
      command: null,
      restrictions: {
        bash: { blockedCommands: ["rm"] },
      },
    });

    expect(result.allowed).toBe(true);
  });

  it("blocks bash commands matched by blockedCommands (prefix match)", () => {
    parseCompoundCommand.mockReturnValue([["rm", "-rf", "/"]]);

    const result = evaluateToolRestrictions({
      toolName: "bash",
      command: ["rm", "-rf", "/"],
      restrictions: {
        bash: { blockedCommands: ["rm"] },
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("command_blocked");
    expect(result.policy).toEqual({ type: "bash", tool: "bash" });
  });

  it("enforces bash allowlist across multiple commands", () => {
    parseCompoundCommand.mockReturnValue([["echo", "hi"], ["touch", "file.txt"]]);

    const result = evaluateToolRestrictions({
      toolName: "bash",
      command: "echo hi && touch file.txt",
      restrictions: {
        bash: { allowedCommands: ["echo"] },
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("command_not_allowed");
  });

  it("allows when all parsed commands are allowed", () => {
    parseCompoundCommand.mockReturnValue([["echo", "hi"], ["ls", "-la"]]);

    const result = evaluateToolRestrictions({
      toolName: "bash",
      command: "echo hi && ls -la",
      restrictions: {
        bash: { allowedCommands: ["echo", "ls"] },
      },
    });

    expect(result.allowed).toBe(true);
  });

  it("ignores bash restrictions for tools not listed", () => {
    parseCompoundCommand.mockReturnValue([["rm", "-rf", "/"]]);

    const result = evaluateToolRestrictions({
      toolName: "bash",
      command: "rm -rf /",
      restrictions: {
        bash: {
          toolNames: ["sh"],
          blockedCommands: ["rm"],
        },
      },
    });

    expect(result.allowed).toBe(true);
  });

  it("handles numeric tool names and numeric strings", () => {
    const restrictions = {
      allowedTools: ["0", "-1", String(Number.MAX_SAFE_INTEGER), 42],
    };

    expect(evaluateToolRestrictions({ toolName: 0, restrictions }).allowed).toBe(true);
    expect(evaluateToolRestrictions({ toolName: -1, restrictions }).allowed).toBe(true);
    expect(evaluateToolRestrictions({ toolName: Number.MAX_SAFE_INTEGER, restrictions }).allowed).toBe(true);
    expect(evaluateToolRestrictions({ toolName: "42", restrictions }).allowed).toBe(true);
  });

  it("handles whitespace tool names and object command inputs", () => {
    const toolResult = evaluateToolRestrictions({
      toolName: "   ",
      restrictions: { allowedTools: ["read"] },
    });

    expect(toolResult.allowed).toBe(false);
    expect(toolResult.reason).toBe("tool_not_allowed");

    parseCompoundCommand.mockReturnValue([]);
    let commandResult;

    expect(() => {
      commandResult = evaluateToolRestrictions({
        toolName: "bash",
        command: { 0: "ls" },
        restrictions: { bash: { allowedCommands: ["ls"] } },
      });
    }).not.toThrow();
    expect(commandResult.allowed).toBe(false);
    expect(commandResult.reason).toBe("command_not_allowed");
  });

  it("supports rapid repeated calls", async () => {
    parseCompoundCommand.mockReturnValue([["ls"]]);
    const restrictions = { bash: { allowedCommands: ["ls"] } };

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        Promise.resolve(evaluateToolRestrictions({ toolName: "bash", command: "ls", restrictions })),
      ),
    );

    expect(results.every((result) => result.allowed)).toBe(true);
  });

  it("handles long command strings and deep nesting", () => {
    const longPath = `/${"a".repeat(12000)}`;
    parseCompoundCommand.mockReturnValue([["cat", longPath]]);

    const result = evaluateToolRestrictions({
      toolName: "bash",
      command: `cat ${longPath}`,
      restrictions: {
        bash: {
          allowedCommands: ["cat"],
          toolNames: ["bash"],
          nested: { level1: { level2: { level3: "value" } } },
        },
      },
    });

    expect(result.allowed).toBe(true);
  });
});
