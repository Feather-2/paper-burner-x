import { describe, it, expect, vi, beforeEach } from "vitest";
import { homedir } from "node:os";
import {
  classifyCommand,
  parseCompoundCommand,
  __internal,
} from "../../../../../js/agents/runtime/safety/command-classifier.js";

vi.mock("node:os", () => ({
  homedir: () => "/home/mock",
}));

const { tokenizeShell, toBaseName, hasCommandSubstitution } = __internal;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseCompoundCommand", () => {
  it("parses a simple command", () => {
    expect(parseCompoundCommand("ls -la")).toEqual([["ls", "-la"]]);
  });

  it("splits compound commands by connectors", () => {
    const input = "a && b || c ; d | e & f";
    expect(parseCompoundCommand(input)).toEqual([
      ["a"],
      ["b"],
      ["c"],
      ["d"],
      ["e"],
      ["f"],
    ]);
  });

  it("keeps quoted connectors intact", () => {
    expect(parseCompoundCommand("echo 'a && b' && ls")).toEqual([
      ["echo", "a && b"],
      ["ls"],
    ]);
  });

  it("handles escaped characters", () => {
    expect(parseCompoundCommand('echo "a\\"b"')).toEqual([["echo", 'a"b']]);
    expect(parseCompoundCommand("echo hello\\ world")).toEqual([
      ["echo", "hello world"],
    ]);
  });

  it("expands bash -c wrapper from string", () => {
    expect(parseCompoundCommand("bash -c 'ls && rm -rf /'"))
      .toEqual([["ls"], ["rm", "-rf", "/"]]);
  });

  it("expands bash -c wrapper from argv array", () => {
    expect(parseCompoundCommand(["bash", "-c", "ls && rm -rf /"]))
      .toEqual([["ls"], ["rm", "-rf", "/"]]);
  });

  it("returns argv as-is when not a shell -c wrapper", () => {
    expect(parseCompoundCommand(["git", "status"]))
      .toEqual([["git", "status"]]);
  });

  it("returns empty for empty-like inputs", () => {
    expect(parseCompoundCommand("")).toEqual([]);
    expect(parseCompoundCommand("   ")).toEqual([]);
    expect(parseCompoundCommand(null)).toEqual([]);
    expect(parseCompoundCommand(undefined)).toEqual([]);
    expect(parseCompoundCommand([])).toEqual([]);
  });

  it("handles object input as empty", () => {
    expect(parseCompoundCommand({})).toEqual([]);
  });

  it("handles numeric boundary values", () => {
    expect(parseCompoundCommand(0)).toEqual([]);
    expect(parseCompoundCommand(-1)).toEqual([]);
    expect(parseCompoundCommand(Number.MAX_SAFE_INTEGER)).toEqual([]);
  });

  it("parses numeric strings as commands", () => {
    expect(parseCompoundCommand("123")).toEqual([["123"]]);
  });

  it("handles missing script for bash -c array", () => {
    expect(parseCompoundCommand(["bash", "-c"])).toEqual([]);
  });

  it("parses deep paths", () => {
    const deepPath = `/${Array.from({ length: 40 }, (_, i) => `dir${i}`)
      .join("/")}/file.txt`;
    expect(parseCompoundCommand(`cat ${deepPath}`)).toEqual([
      ["cat", deepPath],
    ]);
  });

  it("handles very long arguments", () => {
    const longArg = "a".repeat(10000);
    expect(parseCompoundCommand(`echo ${longArg}`)).toEqual([
      ["echo", longArg],
    ]);
  });

  it("handles rapid consecutive calls", () => {
    const results = Array.from({ length: 200 }, (_, i) =>
      parseCompoundCommand(`echo ${i}`)
    );
    expect(results[0]).toEqual([["echo", "0"]]);
    expect(results[199]).toEqual([["echo", "199"]]);
  });
});

describe("__internal.tokenizeShell", () => {
  it("tokenizes simple commands", () => {
    expect(tokenizeShell("ls -la")).toEqual(["ls", "-la"]);
  });

  it("tokenizes connectors and adjacency", () => {
    expect(tokenizeShell("a&&b||c")).toEqual(["a", "&&", "b", "||", "c"]);
    expect(tokenizeShell("a|b & c;d")).toEqual([
      "a",
      "|",
      "b",
      "&",
      "c",
      ";",
      "d",
    ]);
  });

  it("respects quoted strings", () => {
    expect(tokenizeShell("echo 'a && b'"))
      .toEqual(["echo", "a && b"]);
    expect(tokenizeShell('echo "a b c"'))
      .toEqual(["echo", "a b c"]);
  });

  it("handles escaped characters", () => {
    expect(tokenizeShell('echo "a\\"b"')).toEqual(["echo", 'a"b']);
    expect(tokenizeShell("echo hello\\ world")).toEqual([
      "echo",
      "hello world",
    ]);
  });

  it("handles empty-like inputs", () => {
    expect(tokenizeShell("")).toEqual([]);
    expect(tokenizeShell(null)).toEqual([]);
    expect(tokenizeShell(undefined)).toEqual([]);
    expect(tokenizeShell([])).toEqual([]);
  });

  it("handles numeric boundary inputs", () => {
    expect(tokenizeShell(0)).toEqual(["0"]);
    expect(tokenizeShell(-1)).toEqual(["-1"]);
    expect(tokenizeShell(Number.MAX_SAFE_INTEGER)).toEqual([
      String(Number.MAX_SAFE_INTEGER),
    ]);
  });

  it("handles object inputs", () => {
    expect(tokenizeShell({})).toEqual(["[object", "Object]"]);
  });

  it("handles very long strings", () => {
    const longToken = "x".repeat(20000);
    expect(tokenizeShell(longToken)).toEqual([longToken]);
  });
});

describe("__internal.toBaseName", () => {
  it("extracts base command from paths", () => {
    expect(toBaseName("/usr/bin/ls")).toBe("ls");
    expect(toBaseName("/bin/bash")).toBe("bash");
    expect(toBaseName("C:\\Windows\\System32\\cmd.exe")).toBe("cmd.exe");
  });

  it("normalizes casing and trailing slashes", () => {
    expect(toBaseName("/usr/bin/LS/")).toBe("ls");
    expect(toBaseName("GREP")).toBe("grep");
  });

  it("returns empty for empty-like inputs", () => {
    expect(toBaseName("")).toBe("");
    expect(toBaseName("   ")).toBe("");
    expect(toBaseName(null)).toBe("");
    expect(toBaseName(undefined)).toBe("");
  });

  it("handles numeric boundary values", () => {
    expect(toBaseName(0)).toBe("");
    expect(toBaseName(-1)).toBe("");
    expect(toBaseName(Number.MAX_SAFE_INTEGER)).toBe("");
  });

  it("handles numeric strings", () => {
    expect(toBaseName("123")).toBe("123");
  });

  it("handles deep nested paths", () => {
    const deepPath = `/${Array.from({ length: 50 }, (_, i) => `d${i}`)
      .join("/")}/cmd`;
    expect(toBaseName(deepPath)).toBe("cmd");
  });
});

describe("__internal.hasCommandSubstitution", () => {
  it("detects $() substitution", () => {
    expect(hasCommandSubstitution("echo $(whoami)")).toBe(true);
  });

  it("detects backticks", () => {
    expect(hasCommandSubstitution("echo `whoami`")).toBe(true);
  });

  it("detects process substitution", () => {
    expect(hasCommandSubstitution("diff <(cat a) b")).toBe(true);
    expect(hasCommandSubstitution("cat >(tee out)"))
      .toBe(true);
  });

  it("returns false for normal commands", () => {
    expect(hasCommandSubstitution("ls -la")).toBe(false);
  });

  it("returns false for empty-like inputs", () => {
    expect(hasCommandSubstitution("")).toBe(false);
    expect(hasCommandSubstitution(null)).toBe(false);
    expect(hasCommandSubstitution(undefined)).toBe(false);
    expect(hasCommandSubstitution(0)).toBe(false);
  });
});

describe("classifyCommand", () => {
  const safeCommands = [
    "cat",
    "cd",
    "echo",
    "grep",
    "head",
    "ls",
    "pwd",
    "tail",
    "wc",
    "which",
  ];

  const dangerousCommands = [
    "rm",
    "rmdir",
    "chmod",
    "chown",
    "kill",
    "shutdown",
    "dd",
    "mkfs",
    "mount",
    "umount",
  ];

  describe("allowlisted commands", () => {
    for (const cmd of safeCommands) {
      it(`classifies '${cmd}' as safe`, () => {
        const result = classifyCommand(cmd);
        expect(result).toMatchObject({
          level: "safe",
          requiresApproval: false,
          baseCommand: cmd,
        });
        expect(result.reasons).toEqual(["allowlisted_executable"]);
      });
    }

    it("keeps safe commands safe with arguments", () => {
      expect(classifyCommand("ls -la").level).toBe("safe");
      expect(classifyCommand(["echo", "hello"]).level).toBe("safe");
    });
  });

  describe("dangerous commands", () => {
    for (const cmd of dangerousCommands) {
      it(`classifies '${cmd}' as dangerous`, () => {
        const result = classifyCommand(cmd);
        expect(result).toMatchObject({
          level: "dangerous",
          requiresApproval: true,
          baseCommand: cmd,
        });
        expect(result.reasons).toContain("dangerous_executable");
      });
    }

    it("classifies dangerous commands with paths", () => {
      const result = classifyCommand("/bin/rm -rf /tmp");
      expect(result.level).toBe("dangerous");
      expect(result.baseCommand).toBe("rm");
    });
  });

  describe("sensitive paths", () => {
    it("flags sensitive files for safe commands", () => {
      const result = classifyCommand("cat /etc/passwd");
      expect(result.level).toBe("dangerous");
      expect(result.reasons).toContain("sensitive_path");
    });

    it("normalizes ~ and $HOME for sensitive checks", () => {
      expect(classifyCommand("cat ~/.ssh/id_rsa").level).toBe("dangerous");
      expect(classifyCommand("cat $HOME/.aws/credentials").level)
        .toBe("dangerous");
    });

    it("handles Windows-style paths", () => {
      const result = classifyCommand("cat C:\\Users\\me\\.ssh\\id_rsa");
      expect(result.level).toBe("dangerous");
      expect(result.reasons).toContain("sensitive_path");
    });

    it("uses mocked homedir for sensitive paths", () => {
      const home = homedir();
      expect(home).toBe("/home/mock");
      expect(classifyCommand(`cat ${home}/.ssh/id_ed25519`).level)
        .toBe("dangerous");
    });
  });

  describe("command substitution", () => {
    it("blocks command substitution early", () => {
      const result = classifyCommand("echo $(whoami)");
      expect(result).toEqual({
        level: "dangerous",
        requiresApproval: true,
        reasons: ["command_substitution"],
      });
    });
  });

  describe("fork bomb detection", () => {
    const forkBombs = [
      ":(){ :|:& };:",
      "while true; do echo hi & done",
      "$0 & $0 &",
      "bash -c 'echo hi' &",
    ];

    for (const bomb of forkBombs) {
      it(`detects fork bomb pattern: ${bomb.slice(0, 20)}...`, () => {
        const result = classifyCommand(bomb);
        expect(result.level).toBe("dangerous");
        expect(result.reasons).toContain("fork_bomb");
      });
    }

    it("does not flag normal loops", () => {
      const result = classifyCommand("for i in 1 2; do echo $i; done");
      expect(result.reasons).not.toContain("fork_bomb");
    });
  });

  describe("compound commands", () => {
    it("marks compound with dangerous subcommand as dangerous", () => {
      expect(classifyCommand("ls && rm -rf /").level).toBe("dangerous");
    });

    it("marks compound with unknown subcommand as unknown", () => {
      expect(classifyCommand("ls && unknowncmd").level).toBe("unknown");
      expect(classifyCommand("unknowncmd && ls").level).toBe("unknown");
    });

    it("keeps compound safe when all are allowlisted", () => {
      const result = classifyCommand("ls && pwd && echo hi");
      expect(result.level).toBe("safe");
    });

    it("sensitive path overrides safe commands in compound", () => {
      const result = classifyCommand("ls && cat /etc/shadow");
      expect(result.level).toBe("dangerous");
      expect(result.reasons).toContain("sensitive_path");
    });
  });

  describe("edge cases and type boundaries", () => {
    it("returns empty_command for empty inputs", () => {
      const cases = ["", "   ", null, undefined, [], {}, "&& ||"];
      for (const input of cases) {
        const result = classifyCommand(input);
        expect(result.level).toBe("unknown");
        expect(result.reasons).toContain("empty_command");
      }
    });

    it("returns missing_executable for whitespace argv", () => {
      const result = classifyCommand(["   "]);
      expect(result.level).toBe("unknown");
      expect(result.reasons).toContain("missing_executable");
    });

    it("handles numeric boundary values", () => {
      const values = [0, -1, Number.MAX_SAFE_INTEGER];
      for (const value of values) {
        const result = classifyCommand(value);
        expect(result.level).toBe("unknown");
        expect(result.reasons).toContain("empty_command");
      }
    });

    it("handles numeric string commands", () => {
      const result = classifyCommand("123");
      expect(result.level).toBe("unknown");
      expect(result.baseCommand).toBe("123");
      expect(result.reasons).toContain("unknown_executable");
    });

    it("handles case variations and paths", () => {
      expect(classifyCommand("LS").level).toBe("safe");
      expect(classifyCommand("/bin/LS").level).toBe("safe");
      expect(classifyCommand(["C:\\Windows\\System32\\RM"]).level)
        .toBe("dangerous");
    });

    it("handles bash -c array inputs", () => {
      const result = classifyCommand(["bash", "-c", "ls && rm -rf /"]);
      expect(result.level).toBe("dangerous");
      expect(result.baseCommand).toBe("rm");
    });
  });

  describe("concurrency and resource boundaries", () => {
    it("handles concurrent classifyCommand calls", async () => {
      const commands = [
        "ls",
        "rm -rf /",
        "git status",
        "cat /etc/passwd",
        "echo hi",
      ];
      const results = await Promise.all(
        commands.map((cmd) => Promise.resolve(classifyCommand(cmd)))
      );
      expect(results.map((result) => result.level)).toEqual([
        "safe",
        "dangerous",
        "unknown",
        "dangerous",
        "safe",
      ]);
    });

    it("handles very long and deeply nested paths", () => {
      const longPath = `/tmp/${"a".repeat(15000)}.log`;
      const deepPath = `/${Array.from({ length: 60 }, (_, i) => `n${i}`)
        .join("/")}/file.txt`;
      expect(classifyCommand(`cat ${longPath}`).level).toBe("safe");
      expect(classifyCommand(`cat ${deepPath}`).level).toBe("safe");
    });
  });
});
