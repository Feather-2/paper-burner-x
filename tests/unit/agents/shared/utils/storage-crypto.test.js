import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/shared/utils/value-utils.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
  };
});

import {
  PB_ENCRYPTED_PREFIX,
  isEncryptedString,
  canUseStorageEncryption,
  encryptString,
} from "../../../../../js/agents/shared/utils/storage-crypto.js";
import { toNonEmptyString } from "../../../../../js/agents/shared/utils/value-utils.js";

const ORIGINAL_CRYPTO_DESCRIPTOR = Object.getOwnPropertyDescriptor(globalThis, "crypto");

function setGlobalCrypto(value) {
  Object.defineProperty(globalThis, "crypto", {
    value,
    configurable: true,
    writable: true,
  });
}

function restoreGlobalCrypto() {
  if (ORIGINAL_CRYPTO_DESCRIPTOR) {
    Object.defineProperty(globalThis, "crypto", ORIGINAL_CRYPTO_DESCRIPTOR);
  } else {
    delete globalThis.crypto;
  }
}

function createFakeCrypto() {
  const calls = {
    importKey: [],
    deriveKey: [],
    encrypt: [],
    getRandomValues: [],
  };
  let counter = 0;

  const subtle = {
    importKey: vi.fn(async (...args) => {
      calls.importKey.push(args);
      return { kind: "keyMaterial" };
    }),
    deriveKey: vi.fn(async (...args) => {
      calls.deriveKey.push(args);
      return { kind: "aesKey" };
    }),
    encrypt: vi.fn(async (...args) => {
      calls.encrypt.push(args);
      const alg = args[0] || {};
      const data = args[2];
      const dataLength = typeof data?.byteLength === "number" ? data.byteLength : data?.length || 0;
      const iv = alg.iv;
      const ivLength = typeof iv?.byteLength === "number" ? iv.byteLength : iv?.length || 0;
      counter += 1;
      const out = new Uint8Array(8);
      out[0] = counter & 0xff;
      out[1] = dataLength & 0xff;
      out[2] = (dataLength >> 8) & 0xff;
      out[3] = ivLength & 0xff;
      out[4] = 0xaa;
      out[5] = 0x55;
      out[6] = (counter + 1) & 0xff;
      out[7] = 0;
      return out.buffer;
    }),
  };

  const crypto = {
    subtle,
    getRandomValues: vi.fn((arr) => {
      calls.getRandomValues.push(arr);
      counter += 1;
      for (let i = 0; i < arr.length; i++) {
        arr[i] = (counter + i) & 0xff;
      }
      return arr;
    }),
  };

  return { crypto, calls };
}

function parsePayload(encrypted) {
  expect(encrypted.startsWith(PB_ENCRYPTED_PREFIX)).toBe(true);
  return JSON.parse(encrypted.slice(PB_ENCRYPTED_PREFIX.length));
}

let originalToNonEmptyString;

beforeEach(() => {
  restoreGlobalCrypto();
  vi.clearAllMocks();
  if (!originalToNonEmptyString) {
    originalToNonEmptyString = toNonEmptyString.getMockImplementation();
  }
  toNonEmptyString.mockImplementation(originalToNonEmptyString);
});

describe("PB_ENCRYPTED_PREFIX", () => {
  it("matches the expected constant", () => {
    expect(PB_ENCRYPTED_PREFIX).toBe("pbenc:v1:");
  });

  it("is a non-empty string", () => {
    expect(typeof PB_ENCRYPTED_PREFIX).toBe("string");
    expect(PB_ENCRYPTED_PREFIX.length).toBeGreaterThan(0);
  });
});

describe("isEncryptedString", () => {
  it("returns true for prefixed strings", () => {
    expect(isEncryptedString(PB_ENCRYPTED_PREFIX)).toBe(true);
    expect(isEncryptedString(`${PB_ENCRYPTED_PREFIX}{"ok":true}`)).toBe(true);
  });

  it("returns false for non-string and empty values", () => {
    const cases = [
      null,
      undefined,
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "",
      "   ",
      [],
      {},
      ["pbenc:v1:"],
      { value: PB_ENCRYPTED_PREFIX },
    ];
    for (const value of cases) {
      expect(isEncryptedString(value)).toBe(false);
    }
  });

  it("returns false when prefix is missing or not at start", () => {
    expect(isEncryptedString("pbenc:")).toBe(false);
    expect(isEncryptedString("pbenc:v1")).toBe(false);
    expect(isEncryptedString(`x${PB_ENCRYPTED_PREFIX}{}`)).toBe(false);
  });
});

describe("canUseStorageEncryption", () => {
  it("returns false when crypto is missing", () => {
    setGlobalCrypto(null);
    expect(canUseStorageEncryption()).toBe(false);
  });

  it("returns false when required crypto parts are missing", () => {
    setGlobalCrypto({});
    expect(canUseStorageEncryption()).toBe(false);

    setGlobalCrypto({ subtle: {} });
    expect(canUseStorageEncryption()).toBe(false);

    setGlobalCrypto({ getRandomValues: () => {} });
    expect(canUseStorageEncryption()).toBe(false);

    setGlobalCrypto({ subtle: () => {}, getRandomValues: () => {} });
    expect(canUseStorageEncryption()).toBe(false);
  });

  it("returns true when subtle and getRandomValues are present", () => {
    const { crypto } = createFakeCrypto();
    setGlobalCrypto(crypto);
    expect(canUseStorageEncryption()).toBe(true);
  });
});

describe("encryptString", () => {
  it("throws when WebCrypto is not available", async () => {
    setGlobalCrypto(null);
    await expect(encryptString("data", { passphrase: "pass" })).rejects.toThrow(/WebCrypto/i);
  });

  it("throws when passphrase is missing or blank", async () => {
    const { crypto } = createFakeCrypto();
    setGlobalCrypto(crypto);

    const cases = [undefined, null, "", "   ", []];
    for (const passphrase of cases) {
      await expect(encryptString("data", { passphrase })).rejects.toThrow(/passphrase/i);
    }
  });

  it("creates an encrypted payload with expected metadata", async () => {
    const { crypto, calls } = createFakeCrypto();
    setGlobalCrypto(crypto);

    const encrypted = await encryptString("hello", { passphrase: "secret" });
    const payload = parsePayload(encrypted);

    expect(payload.schemaVersion).toBe("pbenc/1");
    expect(payload.alg).toBe("AES-GCM");
    expect(payload.kdf).toBe("PBKDF2-SHA256");
    expect(payload.iter).toBe(100000);
    expect(Buffer.from(payload.saltB64, "base64").length).toBe(16);
    expect(Buffer.from(payload.ivB64, "base64").length).toBe(12);
    expect(Buffer.from(payload.ctB64, "base64").length).toBeGreaterThan(0);
    expect(calls.getRandomValues.length).toBe(2);
    expect(calls.importKey.length).toBe(1);
    expect(calls.deriveKey.length).toBe(1);
    expect(calls.encrypt.length).toBe(1);
    expect(toNonEmptyString).toHaveBeenCalledWith("secret");
  });

  it("includes additionalData when aad is non-empty after trim", async () => {
    const { crypto, calls } = createFakeCrypto();
    setGlobalCrypto(crypto);

    const aad = "  context  ";
    await encryptString("data", { passphrase: "pass", aad });

    const alg = calls.encrypt[0][0];
    expect(alg.additionalData).toBeInstanceOf(Uint8Array);
    const decoded = new TextDecoder().decode(alg.additionalData);
    expect(decoded).toBe(aad);
  });

  it("omits additionalData when aad is empty or whitespace", async () => {
    const { crypto, calls } = createFakeCrypto();
    setGlobalCrypto(crypto);

    await encryptString("data", { passphrase: "pass", aad: "   " });
    const alg = calls.encrypt[0][0];
    expect("additionalData" in alg).toBe(false);
  });

  it("stringifies plaintext across types and boundaries", async () => {
    const { crypto, calls } = createFakeCrypto();
    setGlobalCrypto(crypto);

    const cases = [
      { value: null, expected: "" },
      { value: undefined, expected: "" },
      { value: "", expected: "" },
      { value: "   ", expected: "   " },
      { value: [], expected: "" },
      { value: {}, expected: "[object Object]" },
      { value: 0, expected: "0" },
      { value: -1, expected: "-1" },
      { value: Number.MAX_SAFE_INTEGER, expected: String(Number.MAX_SAFE_INTEGER) },
    ];

    for (const item of cases) {
      await encryptString(item.value, { passphrase: "pass" });
      const lastCall = calls.encrypt[calls.encrypt.length - 1];
      const decoded = new TextDecoder().decode(lastCall[2]);
      expect(decoded).toBe(item.expected);
    }
  });

  it("clamps iterations to minimum for small or negative values", async () => {
    const { crypto, calls } = createFakeCrypto();
    setGlobalCrypto(crypto);

    const encryptedZero = await encryptString("data", { passphrase: "pass", iterations: 0 });
    const payloadZero = parsePayload(encryptedZero);
    expect(payloadZero.iter).toBe(10000);
    expect(calls.deriveKey[0][0].iterations).toBe(10000);

    const encryptedNeg = await encryptString("data", { passphrase: "pass", iterations: -1 });
    const payloadNeg = parsePayload(encryptedNeg);
    expect(payloadNeg.iter).toBe(10000);
    expect(calls.deriveKey[1][0].iterations).toBe(10000);
  });

  it("uses default iterations for non-number and accepts large iterations", async () => {
    const { crypto, calls } = createFakeCrypto();
    setGlobalCrypto(crypto);

    const encryptedStringIter = await encryptString("data", { passphrase: "pass", iterations: "123" });
    const payloadStringIter = parsePayload(encryptedStringIter);
    expect(payloadStringIter.iter).toBe(100000);
    expect(calls.deriveKey[0][0].iterations).toBe(100000);

    const encryptedMax = await encryptString("data", { passphrase: "pass", iterations: Number.MAX_SAFE_INTEGER });
    const payloadMax = parsePayload(encryptedMax);
    expect(payloadMax.iter).toBe(Number.MAX_SAFE_INTEGER);
    expect(calls.deriveKey[1][0].iterations).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("supports concurrent encryption calls", async () => {
    const { crypto, calls } = createFakeCrypto();
    setGlobalCrypto(crypto);

    const tasks = Array.from({ length: 5 }, (_, i) =>
      encryptString(`data-${i}`, { passphrase: "pass" })
    );
    const results = await Promise.all(tasks);

    expect(new Set(results).size).toBe(results.length);
    for (const result of results) {
      expect(isEncryptedString(result)).toBe(true);
    }
    expect(calls.getRandomValues.length).toBe(results.length * 2);
  });

  it("handles rapid successive calls", async () => {
    const { crypto } = createFakeCrypto();
    setGlobalCrypto(crypto);

    const first = await encryptString("data", { passphrase: "pass" });
    const second = await encryptString("data", { passphrase: "pass" });
    const third = await encryptString("data", { passphrase: "pass" });

    expect(first).not.toBe(second);
    expect(second).not.toBe(third);
  });

  it("handles large strings and deep nested values", async () => {
    const { crypto, calls } = createFakeCrypto();
    setGlobalCrypto(crypto);

    const longString = "a".repeat(200000);
    const largeFile = "b".repeat(1024 * 1024);
    const deep = { level1: { level2: { level3: { level4: { value: "x" } } } } };
    const deepString = JSON.stringify(deep);
    const deepObj = { toString: () => deepString };

    await encryptString(longString, { passphrase: "pass" });
    let decoded = new TextDecoder().decode(calls.encrypt[calls.encrypt.length - 1][2]);
    expect(decoded.length).toBe(longString.length);

    await encryptString(largeFile, { passphrase: "pass" });
    decoded = new TextDecoder().decode(calls.encrypt[calls.encrypt.length - 1][2]);
    expect(decoded.length).toBe(largeFile.length);

    await encryptString(deepObj, { passphrase: "pass" });
    decoded = new TextDecoder().decode(calls.encrypt[calls.encrypt.length - 1][2]);
    expect(decoded).toBe(deepString);
  });
});
