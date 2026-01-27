import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSpies = vi.hoisted(() => ({
  childProcessImported: vi.fn(),
}));

vi.mock("node:child_process", () => {
  mockSpies.childProcessImported();
  return {};
});

const MODULE_PATH =
  "../../../../../js/agents/plugins/transports/index.browser.js";

async function loadModule() {
  return import(MODULE_PATH);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("ProcessTransport", () => {
  it("throws a helpful error when constructed (normal path)", async () => {
    const { ProcessTransport } = await loadModule();

    expect(() => new ProcessTransport()).toThrowError(
      "ProcessTransport is not available in browser runtimes.",
    );
  });

  it("throws for boundary/type/shape constructor arguments", async () => {
    const { ProcessTransport } = await loadModule();

    const longString = "x".repeat(200_000);
    const bigFileBytes = new Uint8Array(1024 * 1024);
    const deepObject = {};
    let cursor = deepObject;
    for (let i = 0; i < 2000; i += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }

    const cases = [
      undefined,
      null,
      "",
      "   ",
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "0",
      "123",
      { 0: "a", length: "1" },
      longString,
      bigFileBytes,
      deepObject,
    ];

    for (const value of cases) {
      expect(() => new ProcessTransport(value)).toThrowError(
        "ProcessTransport is not available in browser runtimes.",
      );
    }
  });

  it("is safe under rapid concurrent constructions", async () => {
    const { ProcessTransport } = await loadModule();

    const attempts = Array.from({ length: 25 }, (_, i) =>
      Promise.resolve().then(() => {
        try {
          new ProcessTransport(i);
          return null;
        } catch (error) {
          return error;
        }
      }),
    );

    const results = await Promise.all(attempts);

    for (const error of results) {
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(
        "ProcessTransport is not available in browser runtimes.",
      );
    }
  });

  it("cannot be called without new (error handling)", async () => {
    const { ProcessTransport } = await loadModule();

    expect(() => ProcessTransport()).toThrow(TypeError);
  });
});

describe("createProcessTransport", () => {
  it("throws a helpful error when called (normal path)", async () => {
    const { createProcessTransport } = await loadModule();

    expect(() => createProcessTransport()).toThrowError(
      "createProcessTransport is not available in browser runtimes.",
    );
  });

  it("throws for boundary args and odd this-binding", async () => {
    const { createProcessTransport } = await loadModule();

    const longString = "y".repeat(200_000);
    const bigFileBytes = new Uint8Array(1024 * 1024);
    const deepArray = [];
    let current = deepArray;
    for (let i = 0; i < 2000; i += 1) {
      const next = [];
      current.push(next);
      current = next;
    }

    const argsCases = [
      [undefined],
      [null],
      [""],
      ["   "],
      [[]],
      [{}],
      [0],
      [-1],
      [Number.MAX_SAFE_INTEGER],
      ["0"],
      ["123"],
      [{ 0: "a", length: "1" }],
      [longString],
      [bigFileBytes],
      [deepArray],
      [null, undefined, "", 0, -1, Number.MAX_SAFE_INTEGER],
    ];

    const thisCases = [undefined, null, "", 0, {}, []];

    for (const thisArg of thisCases) {
      for (const args of argsCases) {
        expect(() => createProcessTransport.apply(thisArg, args)).toThrowError(
          "createProcessTransport is not available in browser runtimes.",
        );
      }
    }
  });

  it("is safe under rapid concurrent calls", async () => {
    const { createProcessTransport } = await loadModule();

    const attempts = Array.from({ length: 25 }, () =>
      Promise.resolve().then(() => {
        try {
          createProcessTransport();
          return null;
        } catch (error) {
          return error;
        }
      }),
    );

    const results = await Promise.all(attempts);

    for (const error of results) {
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(
        "createProcessTransport is not available in browser runtimes.",
      );
    }
  });
});

describe("BinarySkillProvider", () => {
  it("throws a helpful error when constructed (normal path)", async () => {
    const { BinarySkillProvider } = await loadModule();

    expect(() => new BinarySkillProvider()).toThrowError(
      "BinarySkillProvider is not available in browser runtimes.",
    );
  });

  it("throws for boundary/type/shape constructor arguments", async () => {
    const { BinarySkillProvider } = await loadModule();

    const longString = "z".repeat(200_000);
    const bigFileBytes = new Uint8Array(1024 * 1024);
    const deepObject = {};
    let cursor = deepObject;
    for (let i = 0; i < 2000; i += 1) {
      cursor.child = { i };
      cursor = cursor.child;
    }

    const cases = [
      undefined,
      null,
      "",
      "   ",
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "0",
      "123",
      { 0: "a", length: "1" },
      longString,
      bigFileBytes,
      deepObject,
    ];

    for (const value of cases) {
      expect(() => new BinarySkillProvider(value)).toThrowError(
        "BinarySkillProvider is not available in browser runtimes.",
      );
    }
  });

  it("is safe under rapid concurrent constructions", async () => {
    const { BinarySkillProvider } = await loadModule();

    const attempts = Array.from({ length: 25 }, (_, i) =>
      Promise.resolve().then(() => {
        try {
          new BinarySkillProvider({ index: i });
          return null;
        } catch (error) {
          return error;
        }
      }),
    );

    const results = await Promise.all(attempts);

    for (const error of results) {
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(
        "BinarySkillProvider is not available in browser runtimes.",
      );
    }
  });

  it("cannot be called without new (error handling)", async () => {
    const { BinarySkillProvider } = await loadModule();

    expect(() => BinarySkillProvider()).toThrow(TypeError);
  });
});

describe("createBinarySkillProvider", () => {
  it("throws a helpful error when called (normal path)", async () => {
    const { createBinarySkillProvider } = await loadModule();

    expect(() => createBinarySkillProvider()).toThrowError(
      "createBinarySkillProvider is not available in browser runtimes.",
    );
  });

  it("throws for boundary args and odd this-binding", async () => {
    const { createBinarySkillProvider } = await loadModule();

    const longString = "a".repeat(200_000);
    const bigFileBytes = new Uint8Array(1024 * 1024);
    const deepObject = {};
    let cursor = deepObject;
    for (let i = 0; i < 2000; i += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }

    const argsCases = [
      [undefined],
      [null],
      [""],
      ["   "],
      [[]],
      [{}],
      [0],
      [-1],
      [Number.MAX_SAFE_INTEGER],
      ["0"],
      ["123"],
      [{ 0: "a", length: "1" }],
      [longString],
      [bigFileBytes],
      [deepObject],
      [null, undefined, "", 0, -1, Number.MAX_SAFE_INTEGER],
    ];

    const thisCases = [undefined, null, "", 0, {}, []];

    for (const thisArg of thisCases) {
      for (const args of argsCases) {
        expect(() =>
          createBinarySkillProvider.apply(thisArg, args),
        ).toThrowError("createBinarySkillProvider is not available in browser runtimes.");
      }
    }
  });

  it("is safe under rapid concurrent calls", async () => {
    const { createBinarySkillProvider } = await loadModule();

    const attempts = Array.from({ length: 25 }, () =>
      Promise.resolve().then(() => {
        try {
          createBinarySkillProvider();
          return null;
        } catch (error) {
          return error;
        }
      }),
    );

    const results = await Promise.all(attempts);

    for (const error of results) {
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(
        "createBinarySkillProvider is not available in browser runtimes.",
      );
    }
  });
});

describe("default", () => {
  it("does not eagerly import Node-only modules on load", async () => {
    await loadModule();
    expect(mockSpies.childProcessImported).not.toHaveBeenCalled();
  });

  it("exposes the same symbols as named exports", async () => {
    const mod = await loadModule();

    expect(mod.default).not.toBeNull();
    expect(typeof mod.default).toBe("object");
    expect(Object.keys(mod.default).sort()).toEqual([
      "BinarySkillProvider",
      "ProcessTransport",
      "createBinarySkillProvider",
      "createProcessTransport",
    ]);

    expect(mod.default.ProcessTransport).toBe(mod.ProcessTransport);
    expect(mod.default.createProcessTransport).toBe(mod.createProcessTransport);
    expect(mod.default.BinarySkillProvider).toBe(mod.BinarySkillProvider);
    expect(mod.default.createBinarySkillProvider).toBe(
      mod.createBinarySkillProvider,
    );
  });

  it("invokes the same failing stubs via the default export object", async () => {
    const mod = await loadModule();

    expect(() => new mod.default.ProcessTransport()).toThrowError(
      "ProcessTransport is not available in browser runtimes.",
    );
    expect(() => mod.default.createProcessTransport()).toThrowError(
      "createProcessTransport is not available in browser runtimes.",
    );
    expect(() => new mod.default.BinarySkillProvider()).toThrowError(
      "BinarySkillProvider is not available in browser runtimes.",
    );
    expect(() => mod.default.createBinarySkillProvider()).toThrowError(
      "createBinarySkillProvider is not available in browser runtimes.",
    );
  });
});