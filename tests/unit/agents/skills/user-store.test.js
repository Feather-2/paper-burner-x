import { describe, it, expect, vi, beforeEach } from "vitest";

const DEFAULT_AAD = "paperburner:user-skills:v1";
const DEFAULT_ITERATIONS = 100_000;

vi.mock("../../../../js/agents/shared/index.js", () => {
  const toNonEmptyString = (value) => {
    if (value === undefined || value === null) return undefined;
    const text = String(value).trim();
    return text.length ? text : undefined;
  };

  return {
    isPlainObject: (value) => {
      if (value === null || typeof value !== "object") return false;
      if (Array.isArray(value)) return false;
      const proto = Object.getPrototypeOf(value);
      return proto === Object.prototype || proto === null;
    },
    toNonEmptyString,
    isNodeLike: vi.fn(() => true),
    createLogger: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    })),
    safeJsonParse: vi.fn((value) => {
      try {
        return JSON.parse(String(value));
      } catch {
        return null;
      }
    }),
    canUseStorageEncryption: vi.fn(() => true),
    decryptString: vi.fn(async (value) => value),
    encryptString: vi.fn(async (value) => value),
    isEncryptedString: vi.fn(() => false),
  };
});

import * as shared from "../../../../js/agents/shared/index.js";
import { configureUserSkillStoreEncryption } from "../../../../js/agents/skills/user-store.js";

const canUseStorageEncryption = vi.mocked(shared.canUseStorageEncryption);

beforeEach(() => {
  vi.clearAllMocks();
  canUseStorageEncryption.mockReturnValue(true);
  configureUserSkillStoreEncryption({});
});

describe("configureUserSkillStoreEncryption", () => {
  it("returns defaults for empty or non-object options", () => {
    const inputs = [undefined, null, "", {}, []];
    for (const input of inputs) {
      const cfg = configureUserSkillStoreEncryption(input);
      expect(cfg.enabled).toBe(false);
      expect(cfg.passphrase).toBeUndefined();
      expect(cfg.required).toBe(false);
      expect(cfg.aad).toBe(DEFAULT_AAD);
      expect(cfg.iterations).toBe(DEFAULT_ITERATIONS);
      expect(cfg.available).toBe(true);
    }
  });

  it("disables encryption when passphrase is empty or whitespace (non-required)", () => {
    const empty = configureUserSkillStoreEncryption({ enabled: true, passphrase: "" });
    expect(empty.enabled).toBe(false);
    expect(empty.passphrase).toBeUndefined();
    expect(empty.available).toBe(true);

    const whitespace = configureUserSkillStoreEncryption({ enabled: true, passphrase: "   \t" });
    expect(whitespace.enabled).toBe(false);
    expect(whitespace.passphrase).toBeUndefined();
    expect(whitespace.available).toBe(true);
  });

  it("throws when encryption is required but passphrase is missing", () => {
    expect(() => configureUserSkillStoreEncryption({ enabled: true, required: true, passphrase: "" })).toThrow(
      /passphrase/i
    );
  });

  it("disables encryption when WebCrypto is unavailable and not required", () => {
    canUseStorageEncryption.mockReturnValue(false);

    const cfg = configureUserSkillStoreEncryption({ enabled: true, passphrase: "secret" });
    expect(cfg.enabled).toBe(false);
    expect(cfg.passphrase).toBe("secret");
    expect(cfg.available).toBe(false);
  });

  it("throws when encryption is required but WebCrypto is unavailable", () => {
    canUseStorageEncryption.mockReturnValue(false);

    expect(() => configureUserSkillStoreEncryption({ enabled: true, required: true, passphrase: "secret" })).toThrow(
      /unavailable/i
    );
  });

  it("honors explicit disabled flag even with a passphrase", () => {
    const cfg = configureUserSkillStoreEncryption({ enabled: false, passphrase: "keep-me" });
    expect(cfg.enabled).toBe(false);
    expect(cfg.passphrase).toBe("keep-me");
    expect(cfg.available).toBe(true);
  });

  it("normalizes aad and iterations for the normal enabled path", () => {
    const cfg = configureUserSkillStoreEncryption({
      enabled: true,
      passphrase: "  secret  ",
      required: true,
      aad: "  custom-aad  ",
      iterations: 15_500.9,
    });

    expect(cfg.enabled).toBe(true);
    expect(cfg.passphrase).toBe("secret");
    expect(cfg.required).toBe(true);
    expect(cfg.aad).toBe("custom-aad");
    expect(cfg.iterations).toBe(15_500);
    expect(cfg.available).toBe(true);
  });

  it("applies iteration boundaries and accepts numeric passphrase", () => {
    const zeroPassphrase = configureUserSkillStoreEncryption({ enabled: true, passphrase: 0, iterations: 0 });
    expect(zeroPassphrase.enabled).toBe(true);
    expect(zeroPassphrase.passphrase).toBe("0");
    expect(zeroPassphrase.iterations).toBe(10_000);

    const negative = configureUserSkillStoreEncryption({ enabled: true, passphrase: "p", iterations: -1 });
    expect(negative.iterations).toBe(10_000);

    const maxSafe = configureUserSkillStoreEncryption({
      enabled: true,
      passphrase: "p",
      iterations: Number.MAX_SAFE_INTEGER,
    });
    expect(maxSafe.iterations).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("handles type mismatches for iterations and string fields", () => {
    const cfg = configureUserSkillStoreEncryption({
      enabled: true,
      passphrase: { nested: true },
      aad: ["alpha", "beta"],
      iterations: "20000",
    });

    expect(cfg.enabled).toBe(true);
    expect(cfg.passphrase).toBe("[object Object]");
    expect(cfg.aad).toBe("alpha,beta");
    expect(cfg.iterations).toBe(DEFAULT_ITERATIONS);
  });

  it("supports concurrent configuration calls", async () => {
    const [first, second] = await Promise.all([
      Promise.resolve().then(() => configureUserSkillStoreEncryption({ enabled: true, passphrase: "first", iterations: 12_000 })),
      Promise.resolve().then(() => configureUserSkillStoreEncryption({ enabled: true, passphrase: "second", iterations: 13_000 })),
    ]);

    expect(first.passphrase).toBe("first");
    expect(first.iterations).toBe(12_000);
    expect(second.passphrase).toBe("second");
    expect(second.iterations).toBe(13_000);
  });

  it("handles rapid successive calls without cross-talk", () => {
    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(configureUserSkillStoreEncryption({ enabled: true, passphrase: `p${i}`, iterations: 10_000 + i }));
    }

    expect(results[0].passphrase).toBe("p0");
    expect(results[4].passphrase).toBe("p4");
    expect(results[4].iterations).toBe(10_004);
  });

  it("handles long strings and deep nested options", () => {
    const longString = "x".repeat(200_000);
    const deepNested = { a: { b: { c: { d: { e: { f: { g: "h" } } } } } } };

    const cfg = configureUserSkillStoreEncryption({
      enabled: true,
      passphrase: longString,
      aad: longString,
      iterations: 20_000,
      metadata: deepNested,
    });

    expect(cfg.enabled).toBe(true);
    expect(cfg.passphrase.length).toBe(longString.length);
    expect(cfg.aad.length).toBe(longString.length);
    expect(cfg.iterations).toBe(20_000);
  });
});
