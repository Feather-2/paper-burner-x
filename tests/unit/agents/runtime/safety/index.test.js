import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
    isPlainObject: vi.fn(actual.isPlainObject),
  };
});

import {
  normalizeToolRestrictions,
  evaluateToolRestrictions,
  classifyCommand,
  parseCompoundCommand,
  PermissionLevel,
  ToolPermissions,
  getPresetRestrictions,
  mergeRestrictions,
} from "../../../../../js/agents/runtime/safety/index.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("normalizeToolRestrictions", () => {
  it("returns null for empty or invalid inputs", () => {
    const samples = [null, undefined, "", "   ", [], {}];

    for (const sample of samples) {
      expect(normalizeToolRestrictions(sample)).toBe(null);
    }
  });

  it("normalizes lists, defaults bash toolNames, and tolerates deep nesting", () => {
    const normalized = normalizeToolRestrictions({
      allowedTools: "read, write\nbash",
      blockedTools: ["delete", "", null],
      bash: {
        allowedCommands: "ls, cat",
        blockedCommands: ["rm -rf /", ""],
        toolNames: ["BASH", "Shell", " "],
        nested: { level1: { level2: { level3: "value" } } },
      },
      meta: { deep: { deeper: { deepest: true } } },
    });

    expect(normalized.allowedTools).toEqual(["read", "write", "bash"]);
    expect(normalized.blockedTools).toEqual(["delete"]);
    expect(normalized.bash.allowedCommands).toEqual(["ls", "cat"]);
    expect(normalized.bash.blockedCommands).toEqual(["rm -rf /"]);
    expect(normalized.bash.toolNames).toEqual(["bash", "shell"]);
  });

  it("defaults bash toolNames when missing", () => {
    const normalized = normalizeToolRestrictions({
      bash: {
        allowedCommands: ["ls"],
      },
    });

    expect(normalized.bash.toolNames).toEqual(["bash"]);
  });

  it("ignores non-list types and object-as-array values", () => {
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
  it("allows when restrictions are missing", () => {
    const samples = [null, undefined, false, {}, []];

    for (const restrictions of samples) {
      const result = evaluateToolRestrictions({ toolName: "read", restrictions });
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks tools not in allowlist", () => {
    const result = evaluateToolRestrictions({
      toolName: "write",
      restrictions: { allowedTools: ["read"] },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("tool_not_allowed");
    expect(result.policy).toEqual({ type: "allowlist", tool: "write" });
  });

  it("blocks tools in blocklist even if allowlisted", () => {
    const result = evaluateToolRestrictions({
      toolName: "write",
      restrictions: { allowedTools: ["write"], blockedTools: ["write"] },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("tool_blocked");
    expect(result.policy).toEqual({ type: "blocklist", tool: "write" });
  });

  it("allows bash commands when allowlist matches prefix", () => {
    const result = evaluateToolRestrictions({
      toolName: "bash",
      command: "git status -sb",
      restrictions: {
        bash: {
          allowedCommands: ["git status"],
        },
      },
    });

    expect(result.allowed).toBe(true);
  });

  it("blocks command substitution", () => {
    const result = evaluateToolRestrictions({
      toolName: "BASH",
      command: "echo $(pwd)",
      restrictions: {
        bash: {
          allowedCommands: ["echo"],
        },
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("command_substitution");
    expect(result.policy).toEqual({ type: "bash", tool: "bash" });
  });

  it("blocks when compound contains blocked command", () => {
    const result = evaluateToolRestrictions({
      toolName: "bash",
      command: "ls && rm -rf /",
      restrictions: {
        bash: {
          blockedCommands: ["rm -rf /"],
        },
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("command_blocked");
    expect(result.policy).toEqual({ type: "bash", tool: "bash" });
  });

  it("handles object command input with allowlist", () => {
    let result;

    expect(() => {
      result = evaluateToolRestrictions({
        toolName: "bash",
        command: { 0: "ls" },
        restrictions: {
          bash: {
            allowedCommands: ["ls"],
          },
        },
      });
    }).not.toThrow();

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("command_not_allowed");
  });

  it("supports concurrent evaluations", async () => {
    const restrictions = { bash: { allowedCommands: ["ls"] } };

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        Promise.resolve(
          evaluateToolRestrictions({
            toolName: "bash",
            command: "ls",
            restrictions,
          }),
        ),
      ),
    );

    expect(results.every((result) => result.allowed)).toBe(true);
  });
});

describe("parseCompoundCommand", () => {
  it("parses simple and numeric string commands", () => {
    expect(parseCompoundCommand("echo hi")).toEqual([["echo", "hi"]]);
    expect(parseCompoundCommand("123")).toEqual([["123"]]);
  });

  it("returns empty for nullish, whitespace, object, and empty array inputs", () => {
    const samples = [null, undefined, "", "   ", [], {}];

    for (const sample of samples) {
      expect(parseCompoundCommand(sample)).toEqual([]);
    }
  });

  it("handles long arguments", () => {
    const longArg = "a".repeat(10000);
    expect(parseCompoundCommand(`echo ${longArg}`)).toEqual([["echo", longArg]]);
  });

  it("supports concurrent and rapid successive calls", async () => {
    const inputs = ["ls -la", "echo hi", "pwd"];
    const results = await Promise.all(inputs.map((cmd) => Promise.resolve(parseCompoundCommand(cmd))));

    expect(results).toEqual([
      [["ls", "-la"]],
      [["echo", "hi"]],
      [["pwd"]],
    ]);

    const repeated = [];
    for (let i = 0; i < 20; i += 1) {
      repeated.push(parseCompoundCommand("whoami"));
    }

    expect(repeated.every((parsed) => parsed.length === 1 && parsed[0][0] === "whoami")).toBe(true);
  });
});

describe("classifyCommand", () => {
  it("flags command substitution as dangerous", () => {
    const result = classifyCommand("echo $(whoami)");

    expect(result.level).toBe("dangerous");
    expect(result.requiresApproval).toBe(true);
    expect(result.reasons).toContain("command_substitution");
  });

  it("handles numeric inputs and whitespace as unknown", () => {
    const samples = [0, -1, Number.MAX_SAFE_INTEGER, "   "];

    for (const sample of samples) {
      const result = classifyCommand(sample);
      expect(result.level).toBe("unknown");
      expect(result.requiresApproval).toBe(true);
      expect(result.reasons).toContain("empty_command");
    }
  });

  it("classifies numeric strings and object inputs consistently", () => {
    const numeric = classifyCommand("123");
    expect(numeric.level).toBe("unknown");
    expect(numeric.baseCommand).toBe("123");
    expect(numeric.reasons).toContain("unknown_executable");

    const obj = classifyCommand({});
    expect(obj.level).toBe("unknown");
    expect(obj.reasons).toContain("empty_command");
  });

  it("handles huge file paths and concurrent calls", async () => {
    const hugePath = `/tmp/${"a".repeat(12000)}`;
    const hugeResult = classifyCommand(`cat ${hugePath}`);

    expect(hugeResult.level).toBe("safe");
    expect(hugeResult.requiresApproval).toBe(false);
    expect(hugeResult.baseCommand).toBe("cat");

    const results = await Promise.all([
      Promise.resolve(classifyCommand("ls")),
      Promise.resolve(classifyCommand("rm -rf /")),
      Promise.resolve(classifyCommand("unknowncmd")),
    ]);

    expect(results[0].level).toBe("safe");
    expect(results[1].level).toBe("dangerous");
    expect(results[2].level).toBe("unknown");
  });
});

describe("PermissionLevel", () => {
  it("exposes expected levels", () => {
    expect(PermissionLevel.READONLY).toBe("readonly");
    expect(PermissionLevel.STANDARD).toBe("standard");
    expect(PermissionLevel.ELEVATED).toBe("elevated");
    expect(PermissionLevel.CUSTOM).toBe("custom");
  });
});

describe("getPresetRestrictions", () => {
  it("returns readonly restrictions for read-only alias", () => {
    const restrictions = getPresetRestrictions("read-only");

    expect(restrictions.blockedTools).toContain("write");
    expect(restrictions.bash.allowedCommands).toContain("ls");
  });

  it("defaults to standard for undefined, whitespace, or numeric inputs", () => {
    const samples = [undefined, "   ", 0, -1, Number.MAX_SAFE_INTEGER];

    for (const sample of samples) {
      const restrictions = getPresetRestrictions(sample);
      expect(restrictions.bash.blockedCommands).toContain("dd if=/dev/zero");
    }
  });

  it("returns elevated for admin and null for custom", () => {
    const elevated = getPresetRestrictions("ADMIN");

    expect(elevated.bash.blockedCommands).toContain("dd if=/dev/zero of=/dev/sda");
    expect(getPresetRestrictions("custom")).toBe(null);
  });
});

describe("mergeRestrictions", () => {
  it("returns null when both inputs are empty", () => {
    expect(mergeRestrictions(null, undefined)).toBe(null);
    expect(mergeRestrictions({}, {})).toBe(null);
  });

  it("merges lists and overrides bash allowlist", () => {
    const merged = mergeRestrictions(
      {
        allowedTools: ["read"],
        blockedTools: ["delete"],
        bash: {
          allowedCommands: ["ls"],
          blockedCommands: ["rm -rf /"],
          toolNames: ["bash"],
        },
      },
      {
        allowedTools: ["write"],
        blockedTools: ["remove"],
        bash: {
          allowedCommands: ["pwd"],
          blockedCommands: ["dd if=/dev/zero"],
          toolNames: ["shell", "bash"],
          nested: { a: { b: { c: true } } },
        },
      },
    );

    expect(merged.allowedTools).toEqual(["read", "write"]);
    expect(merged.blockedTools).toEqual(["delete", "remove"]);
    expect(merged.bash.allowedCommands).toEqual(["pwd"]);
    expect(merged.bash.blockedCommands).toEqual(["rm -rf /", "dd if=/dev/zero"]);
    expect(merged.bash.toolNames).toEqual(["bash", "shell"]);
  });

  it("keeps base bash allowlist when override lacks it", () => {
    const merged = mergeRestrictions(
      {
        bash: { allowedCommands: ["ls"], toolNames: ["bash"] },
      },
      {
        bash: { blockedCommands: ["rm -rf /"] },
      },
    );

    expect(merged.bash.allowedCommands).toEqual(["ls"]);
    expect(merged.bash.blockedCommands).toEqual(["rm -rf /"]);
    expect(merged.bash.toolNames).toEqual(["bash"]);
  });
});

describe("ToolPermissions", () => {
  it("defaults to standard for invalid config and fromJSON inputs", () => {
    const perm = new ToolPermissions(null);
    const restored = ToolPermissions.fromJSON([]);

    expect(perm.getLevel()).toBe("standard");
    expect(restored.getLevel()).toBe("standard");
    expect(perm.check(0, null).allowed).toBe(true);
  });

  it("honors strict allowlist with wildcard and regex patterns", () => {
    const perm = new ToolPermissions({
      level: "custom",
      restrictions: { allowedTools: ["read*", /bash/] },
      strict: true,
    });

    expect(perm.check("read_file", null).allowed).toBe(true);
    expect(perm.check("bash", "ls").allowed).toBe(true);

    const blocked = perm.check("write", null);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe("tool_not_allowed");
  });

  it("createHook extracts command from params and blocks unsafe commands", () => {
    const perm = ToolPermissions.standard();
    const hook = perm.createHook();

    const blocked = hook({ tool: "bash", params: { cmd: "rm -rf /" } });
    expect(blocked.skip).toBe(true);
    expect(blocked.value.ok).toBe(false);

    const allowed = hook({ tool: "bash", params: "ls -la" });
    expect(allowed).toBe(null);
  });

  it("supports concurrent and rapid checks with long commands", async () => {
    const perm = ToolPermissions.standard();
    const longCmd = `echo ${"a".repeat(10000)}`;

    const results = await Promise.all(
      Array.from({ length: 5 }, () => Promise.resolve(perm.check("bash", longCmd))),
    );

    expect(results.every((result) => result.allowed)).toBe(true);

    const repeated = [];
    for (let i = 0; i < 20; i += 1) {
      repeated.push(perm.check("bash", "pwd"));
    }

    expect(repeated.every((result) => result.allowed)).toBe(true);
  });
});
