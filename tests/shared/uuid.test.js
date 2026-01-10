/**
 * @file tests/shared/uuid.test.js
 * @description generateUUID (RFC 4122 v4) 单元测试
 */

import { describe, it, expect, vi } from "vitest";

import { generateUUID } from "../../js/shared/utils/uuid.js";

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ORIGINAL_CRYPTO_DESCRIPTOR = Object.getOwnPropertyDescriptor(globalThis, "crypto");

const setCrypto = (cryptoValue) => {
  Object.defineProperty(globalThis, "crypto", {
    value: cryptoValue,
    configurable: true,
    enumerable: true,
  });
};

const restoreCrypto = () => {
  if (ORIGINAL_CRYPTO_DESCRIPTOR) {
    Object.defineProperty(globalThis, "crypto", ORIGINAL_CRYPTO_DESCRIPTOR);
    return;
  }
  // Some environments might not define `crypto` at all.
  delete globalThis.crypto;
};

describe("generateUUID", () => {
  it("should prefer crypto.randomUUID when available", () => {
    const cryptoStub = {
      randomUUID: vi.fn(() => "11111111-1111-4111-8111-111111111111"),
      getRandomValues: vi.fn(() => {
        throw new Error("getRandomValues should not be called when randomUUID exists");
      }),
    };

    try {
      setCrypto(cryptoStub);
      const id = generateUUID();

      expect(cryptoStub.randomUUID).toHaveBeenCalledTimes(1);
      expect(cryptoStub.getRandomValues).not.toHaveBeenCalled();
      expect(id).toBe("11111111-1111-4111-8111-111111111111");
      expect(id).toMatch(UUID_V4_REGEX);
    } finally {
      restoreCrypto();
    }
  });

  it("should generate RFC 4122 UUID v4 format", () => {
    const id = generateUUID();

    expect(id).toMatch(UUID_V4_REGEX);
    // xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(id[14]).toBe("4");
    expect(["8", "9", "a", "b"]).toContain(id[19].toLowerCase());
  });

  it("should generate unique UUIDs", () => {
    const count = 1000;
    const ids = new Set();

    for (let i = 0; i < count; i += 1) {
      ids.add(generateUUID());
    }

    expect(ids.size).toBe(count);
  });

  it("should set version/variant bits when using crypto.getRandomValues", () => {
    let calledGetRandomValues = false;
    const cryptoStub = {
      getRandomValues: (bytes) => {
        calledGetRandomValues = true;
        bytes.fill(0);
        return bytes;
      },
    };

    try {
      setCrypto(cryptoStub);
      const id = generateUUID();

      expect(calledGetRandomValues).toBe(true);
      expect(id).toBe("00000000-0000-4000-8000-000000000000");
      expect(id).toMatch(UUID_V4_REGEX);
    } finally {
      restoreCrypto();
    }
  });

  it("should fallback to Math.random when crypto is unavailable", () => {
    const originalRandom = Math.random;
    Math.random = () => 0;

    try {
      setCrypto(undefined);
      const id = generateUUID();

      expect(id).toBe("00000000-0000-4000-8000-000000000000");
      expect(id).toMatch(UUID_V4_REGEX);
    } finally {
      Math.random = originalRandom;
      restoreCrypto();
    }
  });
});
