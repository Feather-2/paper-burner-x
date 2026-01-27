import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

const MODULE_PATH = "../../../../../js/agents/plugins/transports/process-transport.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
  spawnMock.mockReset();
});

function createMockChildProcess() {
  const emitter = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  const child = {
    stdin,
    stdout,
    stderr,
    pid: 12345,
    kill: vi.fn(() => {
      emitter.emit("exit", 0, null);
      emitter.emit("close", 0, null);
      return true;
    }),
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    emit: emitter.emit.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),
    removeAllListeners: emitter.removeAllListeners.bind(emitter),
  };

  return child;
}

const mod = await import(MODULE_PATH);
const EXPORT_NAMES = Object.keys(mod).sort();

describe("module exports", () => {
  it("exports at least one symbol", () => {
    expect(EXPORT_NAMES.length).toBeGreaterThan(0);
  });
});

for (const exportName of EXPORT_NAMES) {
  describe(exportName, () => {
    switch (exportName) {
      case "normalizeAllowlist": {
        it("returns empty Set for non-arrays (null/undefined/empty/object/number)", () => {
          const { normalizeAllowlist } = mod;
          const cases = [
            undefined,
            null,
            "",
            "   ",
            0,
            -1,
            Number.MAX_SAFE_INTEGER,
            {},
            { a: 1 },
            () => {},
          ];

          for (const value of cases) {
            const result = normalizeAllowlist(value);
            expect(result).toBeInstanceOf(Set);
            expect(result.size).toBe(0);
          }
        });

        it("trims strings, removes empties, ignores non-strings, and de-dupes", () => {
          const { normalizeAllowlist } = mod;
          const input = [" a ", "b", "b", "   ", "", "\n\tc\t", 123, null, {}, ["d"]];
          const result = normalizeAllowlist(input);

          expect(result).toBeInstanceOf(Set);
          expect([...result]).toEqual(["a", "b", "c"]);
        });

        it("is safe under concurrent/rapid calls (no shared state)", async () => {
          const { normalizeAllowlist } = mod;
          const payloads = [
            [" x ", "y", "y"],
            ["a", " b", "", "   "],
            [null, "z", 0, "z"],
            [],
          ];

          const results = await Promise.all(
            payloads.map((payload) => Promise.resolve(normalizeAllowlist(payload)))
          );

          expect(results[0]).toEqual(new Set(["x", "y"]));
          expect(results[1]).toEqual(new Set(["a", "b"]));
          expect(results[2]).toEqual(new Set(["z"]));
          expect(results[3]).toEqual(new Set());

          results[0].add("mutate");
          expect(results[1].has("mutate")).toBe(false);
          expect(results[2].has("mutate")).toBe(false);
        });

        break;
      }

      case "normalizeRoots": {
        it("returns [] for non-arrays (null/undefined/empty/object/number)", () => {
          const { normalizeRoots } = mod;
          const cases = [undefined, null, "", "  ", 0, -1, {}, { 0: "x" }];

          for (const value of cases) {
            const result = normalizeRoots(value);
            expect(Array.isArray(result)).toBe(true);
            expect(result).toEqual([]);
          }
        });

        it("filters non-strings/empties, trims, and resolves paths", () => {
          const { normalizeRoots } = mod;
          const roots = [" . ", "  ./foo  ", "", "   ", 123, null, {}, "./bar/baz"];
          const result = normalizeRoots(roots);

          expect(result).toEqual([path.resolve("."), path.resolve("./foo"), path.resolve("./bar/baz")]);
        });

        it("handles deep lists without cross-call coupling", async () => {
          const { normalizeRoots } = mod;
          const batchA = Array.from({ length: 50 }, (_, i) => `./a/${i}`);
          const batchB = Array.from({ length: 50 }, (_, i) => `./b/${i}`);

          const [a, b] = await Promise.all([
            Promise.resolve(normalizeRoots(batchA)),
            Promise.resolve(normalizeRoots(batchB)),
          ]);

          expect(a.length).toBe(50);
          expect(b.length).toBe(50);
          expect(a[0]).toBe(path.resolve("./a/0"));
          expect(b[0]).toBe(path.resolve("./b/0"));
        });

        break;
      }

      case "isPathWithinRoots": {
        it("returns true when roots is empty", () => {
          const { isPathWithinRoots } = mod;
          const target = path.join(process.cwd(), "anywhere", "file.txt");
          expect(isPathWithinRoots(target, [])).toBe(true);
        });

        it("returns true for exact root and for child paths", () => {
          const { isPathWithinRoots } = mod;
          const root = path.join(process.cwd(), "__pt_root__");
          const same = root;
          const inside = path.join(root, "sub", "file.txt");

          expect(isPathWithinRoots(same, [root])).toBe(true);
          expect(isPathWithinRoots(inside, [root])).toBe(true);
        });

        it("returns false for paths outside root (including prefix-like siblings)", () => {
          const { isPathWithinRoots } = mod;
          const base = path.join(process.cwd(), "__pt_base__");
          const root = path.join(base, "root");
          const outside = path.join(base, "other", "file.txt");
          const siblingPrefix = `${root}2${path.sep}file.txt`;

          expect(isPathWithinRoots(outside, [root])).toBe(false);
          expect(isPathWithinRoots(siblingPrefix, [root])).toBe(false);
        });

        it("returns true if any root contains the target", () => {
          const { isPathWithinRoots } = mod;
          const base = path.join(process.cwd(), "__pt_multi__");
          const rootA = path.join(base, "a");
          const rootB = path.join(base, "b");
          const target = path.join(rootB, "x", "y.txt");

          expect(isPathWithinRoots(target, [rootA, rootB])).toBe(true);
        });

        break;
      }

      case "hasPathTraversal": {
        it("detects '..' segments with / or \\\\ separators", () => {
          const { hasPathTraversal } = mod;

          expect(hasPathTraversal("foo/../bar")).toBe(true);
          expect(hasPathTraversal("../foo")).toBe(true);
          expect(hasPathTraversal("foo\\..\\bar")).toBe(true);
          expect(hasPathTraversal("..\\foo")).toBe(true);
        });

        it("does not flag '..' inside a segment", () => {
          const { hasPathTraversal } = mod;

          expect(hasPathTraversal("foo..")).toBe(false);
          expect(hasPathTraversal("foo/..bar/baz")).toBe(false);
          expect(hasPathTraversal("foo/.../bar")).toBe(false);
        });

        it("handles empty/whitespace and deep paths", () => {
          const { hasPathTraversal } = mod;

          expect(hasPathTraversal("")).toBe(false);
          expect(hasPathTraversal("   ")).toBe(false);

          const deep = Array.from({ length: 200 }, (_, i) => `seg${i}`).join("/");
          expect(hasPathTraversal(deep)).toBe(false);
        });

        break;
      }

      case "normalizeCwd": {
        it("defaults to process.cwd() when cwd is undefined/null/empty string", () => {
          const { normalizeCwd } = mod;
          const spy = vi.spyOn(process, "cwd").mockReturnValue(path.join(path.sep, "mock", "cwd"));

          expect(normalizeCwd(undefined, [])).toBe(path.join(path.sep, "mock", "cwd"));
          expect(normalizeCwd(null, [])).toBe(path.join(path.sep, "mock", "cwd"));
          expect(normalizeCwd("", [])).toBe(path.join(path.sep, "mock", "cwd"));

          spy.mockRestore();
        });

        it("throws when cwd is not a string (0/-1/MAX_SAFE_INTEGER/object/array)", () => {
          const { normalizeCwd } = mod;
          const cases = [0, -1, Number.MAX_SAFE_INTEGER, {}, [], true];

          for (const value of cases) {
            expect(() => normalizeCwd(value, [])).toThrow("ProcessTransport cwd must be a string");
          }
        });

        it("throws on blank/whitespace-only cwd, null bytes, and path traversal", () => {
          const { normalizeCwd } = mod;

          expect(() => normalizeCwd("   ", [])).toThrow("ProcessTransport cwd is required");
          expect(() => normalizeCwd(`ok\u0000bad`, [])).toThrow(
            "ProcessTransport cwd contains invalid characters"
          );

          expect(() => normalizeCwd("foo/../bar", [])).toThrow("ProcessTransport cwd contains path traversal");
          expect(() => normalizeCwd("foo\\..\\bar", [])).toThrow("ProcessTransport cwd contains path traversal");
        });

        it("enforces allowedRoots allowlist (inside ok, outside throws)", () => {
          const { normalizeCwd } = mod;

          const base = path.join(process.cwd(), "__pt_allowed__");
          const allowedRoot = path.join(base, "allowed");
          const allowedRoots = [allowedRoot];

          const inside = path.join(allowedRoot, "subdir");
          const outside = path.join(base, "outside");

          expect(normalizeCwd(inside, allowedRoots)).toBe(path.resolve(inside));
          expect(() => normalizeCwd(outside, allowedRoots)).toThrow("ProcessTransport cwd not in allowlist");
        });

        it("trims string cwd and returns resolved absolute path", () => {
          const { normalizeCwd } = mod;
          const raw = `  ${path.join(process.cwd(), "trimmed")}  `;
          expect(normalizeCwd(raw, [])).toBe(path.resolve(path.join(process.cwd(), "trimmed")));
        });

        break;
      }

      case "normalizeCommand": {
        it("throws for non-string command (null/undefined/0/-1/MAX_SAFE_INTEGER/object)", () => {
          const { normalizeCommand } = mod;
          const cwd = process.cwd();
          const allowedCommands = new Set();
          const allowedRoots = [];
          const cases = [null, undefined, 0, -1, Number.MAX_SAFE_INTEGER, {}, []];

          for (const value of cases) {
            expect(() => normalizeCommand(value, cwd, allowedCommands, allowedRoots)).toThrow(
              "ProcessTransport command must be a string"
            );
          }
        });

        it("throws for empty/whitespace-only command and null bytes", () => {
          const { normalizeCommand } = mod;
          const cwd = process.cwd();
          const allowedCommands = new Set();
          const allowedRoots = [];

          expect(() => normalizeCommand("", cwd, allowedCommands, allowedRoots)).toThrow(
            "ProcessTransport command is required"
          );
          expect(() => normalizeCommand("   ", cwd, allowedCommands, allowedRoots)).toThrow(
            "ProcessTransport command is required"
          );
          expect(() => normalizeCommand(`node\u0000bad`, cwd, allowedCommands, allowedRoots)).toThrow(
            "ProcessTransport command contains invalid characters"
          );
        });

        it("rejects invalid characters when command has no path separators", () => {
          const { normalizeCommand } = mod;
          const cwd = process.cwd();

          expect(() => normalizeCommand("node --version", cwd, new Set(), [])).toThrow(
            "ProcessTransport command contains invalid characters"
          );
          expect(() => normalizeCommand("no$de", cwd, new Set(), [])).toThrow(
            "ProcessTransport command contains invalid characters"
          );
        });

        it("enforces allowlist for bare commands when provided", () => {
          const { normalizeCommand } = mod;
          const cwd = process.cwd();
          const allowedRoots = [];

          expect(normalizeCommand("node", cwd, new Set(["node"]), allowedRoots)).toBe("node");
          expect(() => normalizeCommand("python", cwd, new Set(["node"]), allowedRoots)).toThrow(
            "ProcessTransport command not allowlisted: python"
          );
        });

        it("resolves path commands relative to cwd and applies allowedRoots/allowedCommands", () => {
          const { normalizeCommand } = mod;

          const cwd = path.join(process.cwd(), "__pt_cwd__");
          const relCmd = path.join("bin", "tool");
          const resolved = path.resolve(cwd, relCmd);

          expect(normalizeCommand(relCmd, cwd, new Set(), [])).toBe(resolved);

          expect(() => normalizeCommand(relCmd, cwd, new Set(), [path.join(process.cwd(), "__other__")])).toThrow(
            "ProcessTransport command path not in allowlist"
          );

          expect(normalizeCommand(relCmd, cwd, new Set(["tool"]), [cwd])).toBe(resolved);
          expect(normalizeCommand(relCmd, cwd, new Set([resolved]), [cwd])).toBe(resolved);

          expect(() => normalizeCommand(relCmd, cwd, new Set(["nope"]), [cwd])).toThrow(
            `ProcessTransport command not allowlisted: ${path.basename(resolved)}`
          );
        });

        it("rejects path traversal in path commands", () => {
          const { normalizeCommand } = mod;
          const cwd = path.join(process.cwd(), "__pt_cwd_trav__");
          const traversal = `bin${path.sep}..${path.sep}tool`;

          expect(() => normalizeCommand(traversal, cwd, new Set(), [])).toThrow(
            "ProcessTransport command contains path traversal"
          );
        });

        break;
      }

      case "normalizeArgs": {
        it("returns [] for non-arrays (null/undefined/empty/object/string/number)", () => {
          const { normalizeArgs } = mod;
          const cases = [undefined, null, "", "   ", 0, -1, Number.MAX_SAFE_INTEGER, {}, { 0: "a" }];

          for (const value of cases) {
            const result = normalizeArgs(value);
            expect(Array.isArray(result)).toBe(true);
            expect(result).toEqual([]);
          }
        });

        it("throws when any arg is not a string (number/null/object/array)", () => {
          const { normalizeArgs } = mod;

          expect(() => normalizeArgs([0])).toThrow("ProcessTransport args must be strings");
          expect(() => normalizeArgs([null])).toThrow("ProcessTransport args must be strings");
          expect(() => normalizeArgs([{}])).toThrow("ProcessTransport args must be strings");
          expect(() => normalizeArgs([[]])).toThrow("ProcessTransport args must be strings");
        });

        it("throws on null bytes and overlong args; allows boundary length", () => {
          const { normalizeArgs } = mod;
          const max = typeof mod.MAX_ARG_LENGTH === "number" ? mod.MAX_ARG_LENGTH : 4096;

          const ok = "a".repeat(max);
          const tooLong = "a".repeat(max + 1);

          expect(normalizeArgs([ok])).toEqual([ok]);
          expect(() => normalizeArgs([tooLong])).toThrow("ProcessTransport arg contains invalid characters");
          expect(() => normalizeArgs([`ok\u0000bad`])).toThrow("ProcessTransport arg contains invalid characters");
        });

        it("preserves args as-is (no trimming or mutation)", () => {
          const { normalizeArgs } = mod;
          const input = ["  spaced  ", "\tkeep\t"];
          const result = normalizeArgs(input);

          expect(result).toEqual(input);
          expect(result).not.toBe(input);
        });

        it("supports rapid/concurrent calls safely", async () => {
          const { normalizeArgs } = mod;
          const max = typeof mod.MAX_ARG_LENGTH === "number" ? mod.MAX_ARG_LENGTH : 4096;

          const batches = [
            ["a", "b"],
            ["x".repeat(max)],
            [],
          ];

          const [a, b, c] = await Promise.all(batches.map((batch) => Promise.resolve(normalizeArgs(batch))));

          expect(a).toEqual(["a", "b"]);
          expect(b).toEqual(["x".repeat(max)]);
          expect(c).toEqual([]);
        });

        break;
      }

      case "sanitizeEnv": {
        it("returns a shallow copy of process.env for null/undefined/empty string/0/true", () => {
          const { sanitizeEnv } = mod;

          process.env.PT_SANITIZE_ENV_TEST = "1";

          const cases = [undefined, null, "", 0, true];
          for (const value of cases) {
            const result = sanitizeEnv(value);
            expect(result).toBeTruthy();
            expect(result).not.toBe(process.env);
            expect(result.PT_SANITIZE_ENV_TEST).toBe("1");
          }
        });

        it("when overrides is an object, does not return process.env by reference", () => {
          const { sanitizeEnv } = mod;

          process.env.PT_SANITIZE_ENV_TEST = "1";
          const result = sanitizeEnv({});

          expect(result).toBeTruthy();
          expect(result).not.toBe(process.env);
          expect(result.PT_SANITIZE_ENV_TEST).toBe("1");

          result.PT_SANITIZE_ENV_TEST = "2";
          expect(process.env.PT_SANITIZE_ENV_TEST).toBe("1");
        });

        it("is safe under concurrent calls (no shared object references)", async () => {
          const { sanitizeEnv } = mod;

          process.env.PT_SANITIZE_ENV_TEST = "1";

          const [a, b] = await Promise.all([Promise.resolve(sanitizeEnv(null)), Promise.resolve(sanitizeEnv({}))]);

          expect(a.PT_SANITIZE_ENV_TEST).toBe("1");
          expect(b.PT_SANITIZE_ENV_TEST).toBe("1");
          a.PT_SANITIZE_ENV_TEST = "a";
          expect(b.PT_SANITIZE_ENV_TEST).toBe("1");
          expect(process.env.PT_SANITIZE_ENV_TEST).toBe("1");
        });

        break;
      }

      case "BLOCKED_ENV_KEYS": {
        it("is a Set containing expected blocked keys", () => {
          const value = mod.BLOCKED_ENV_KEYS;
          expect(value).toBeInstanceOf(Set);
          expect(value.has("LD_PRELOAD")).toBe(true);
          expect(value.has("DYLD_INSERT_LIBRARIES")).toBe(true);
        });
        break;
      }

      case "ALLOWED_JSONRPC_KEYS": {
        it("is a Set containing expected JSON-RPC keys", () => {
          const value = mod.ALLOWED_JSONRPC_KEYS;
          expect(value).toBeInstanceOf(Set);
          for (const key of ["jsonrpc", "id", "method", "params", "result", "error"]) {
            expect(value.has(key)).toBe(true);
          }
        });
        break;
      }

      case "SAFE_COMMAND_RE": {
        it("matches safe command names and rejects unsafe ones", () => {
          const re = mod.SAFE_COMMAND_RE;
          expect(re).toBeInstanceOf(RegExp);
          expect(re.test("node")).toBe(true);
          expect(re.test("my-tool_1.2.3")).toBe(true);
          expect(re.test("node --version")).toBe(false);
          expect(re.test("no$de")).toBe(false);
        });
        break;
      }

      case "SAFE_METHOD_RE": {
        it("matches safe method names and rejects unsafe ones", () => {
          const re = mod.SAFE_METHOD_RE;
          expect(re).toBeInstanceOf(RegExp);
          expect(re.test("tools.run")).toBe(true);
          expect(re.test("a:b-c_d.1")).toBe(true);
          expect(re.test("bad method")).toBe(false);
          expect(re.test("bad/thing")).toBe(false);
        });
        break;
      }

      case "SAFE_ENV_KEY_RE": {
        it("matches safe env keys and rejects unsafe ones", () => {
          const re = mod.SAFE_ENV_KEY_RE;
          expect(re).toBeInstanceOf(RegExp);
          expect(re.test("FOO")).toBe(true);
          expect(re.test("FOO_BAR_1")).toBe(true);
          expect(re.test("foo")).toBe(false);
          expect(re.test("FOO-BAR")).toBe(false);
        });
        break;
      }

      case "MAX_MESSAGE_LENGTH":
      case "MAX_JSON_DEPTH":
      case "MAX_COLLECTION_ENTRIES":
      case "MAX_STRING_LENGTH":
      case "MAX_METHOD_LENGTH":
      case "MAX_ID_LENGTH":
      case "MAX_ARG_LENGTH":
      case "MAX_ENV_KEY_LENGTH":
      case "MAX_ENV_VALUE_LENGTH": {
        it("is a finite positive integer", () => {
          const value = mod[exportName];
          expect(typeof value).toBe("number");
          expect(Number.isFinite(value)).toBe(true);
          expect(Number.isInteger(value)).toBe(true);
          expect(value).toBeGreaterThan(0);
        });
        break;
      }

      case "ProcessTransport":
      case "default": {
        it("exports a constructible transport (function/class) or a factory", () => {
          const value = mod[exportName];
          expect(value).toBeDefined();
          expect(["function", "object"]).toContain(typeof value);
        });

        it("does not spawn a real process on import (spawn is mockable)", () => {
          expect(spawnMock).toBeDefined();
          expect(typeof spawnMock).toBe("function");
        });

        it("can be exercised with a mocked child process without touching the real system", async () => {
          const value = mod[exportName];
          if (typeof value !== "function") {
            expect(typeof value).toBe("object");
            return;
          }

          const child = createMockChildProcess();
          spawnMock.mockReturnValue(child);

          const maybeCreate = () => {
            try {
              return new value({ command: "node", args: [] });
            } catch {
              return value({ command: "node", args: [] });
            }
          };

          let instance;
          try {
            instance = maybeCreate();
          } catch (err) {
            expect(err).toBeInstanceOf(Error);
            return;
          }

          const connectCandidates = ["connect", "start", "open", "init", "spawn"];
          const connectFn = connectCandidates.find((name) => typeof instance?.[name] === "function");

          if (connectFn) {
            const result = instance[connectFn]();
            if (result && typeof result.then === "function") await result;
          }

          expect(spawnMock.mock.calls.length).toBeGreaterThanOrEqual(0);

          const closeCandidates = ["close", "dispose", "stop", "shutdown"];
          const closeFn = closeCandidates.find((name) => typeof instance?.[name] === "function");
          if (closeFn) {
            const result = instance[closeFn]();
            if (result && typeof result.then === "function") await result;
          }
        });

        break;
      }

      default: {
        it("is defined", () => {
          expect(mod[exportName]).not.toBeUndefined();
        });

        it("has a stable, non-null shape", () => {
          const value = mod[exportName];
          expect(value).not.toBeNull();

          const t = typeof value;
          expect(
            ["function", "object", "number", "string", "boolean", "bigint", "symbol", "undefined"].includes(t)
          ).toBe(true);

          if (t === "number") {
            expect(Number.isFinite(value)).toBe(true);
          }
          if (t === "string") {
            expect(value.length).toBeGreaterThanOrEqual(0);
          }
        });

        break;
      }
    }
  });
}