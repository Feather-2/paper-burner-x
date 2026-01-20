import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedCrypto = vi.hoisted(() => ({
  randomBytes: vi.fn((size) => Buffer.alloc(size, 0x61)),
}));

vi.mock("node:crypto", () => ({
  randomBytes: mockedCrypto.randomBytes,
}));

import { randomBytes } from "node:crypto";

import { cyrb53, computeContentHash } from "../../../../../../js/agents/plugins/memory/l3-storage/hash.js";

const HEX_REGEX = /^[0-9a-f]+$/i;

const HASH_EMPTY = "bdcb81aee8d83";
const HASH_HELLO = "106f3a63cd7226";
const HASH_HELLO_SEED_1 = "1897bfcd0b3443";
const HASH_ZERO = "b2475ab050fb7";
const HASH_NULL = "15e0da69fcb93a";
const HASH_EMPTY_ARRAY = "15202279b28c9e";
const HASH_EMPTY_OBJECT = "1bc27f5a56d1e7";
const HASH_WHITESPACE = "1a3144bff1f43c";
const HASH_123 = "8e4292475525f";
const HASH_NEG_ONE = "5cbb4ccfb09eb";
const HASH_MAX_SAFE = "8ba1412030f08";
const HASH_OBJECT_STRING = "3fc89a3d447fc";

beforeEach(() => {
  mockedCrypto.randomBytes.mockClear();
});

describe("cyrb53", () => {
  it("hashes known values with and without seed", () => {
    expect(cyrb53("hello")).toBe(HASH_HELLO);
    expect(cyrb53("hello", 1)).toBe(HASH_HELLO_SEED_1);
  });

  it("handles empty and whitespace strings", () => {
    expect(cyrb53("")).toBe(HASH_EMPTY);
    expect(cyrb53("   ")).toBe(HASH_WHITESPACE);
  });

  it("returns hex output for long inputs", () => {
    const longInput = "abc".repeat(100_000);
    const hash = cyrb53(longInput);

    expect(hash).toMatch(HEX_REGEX);
    expect(cyrb53(longInput)).toBe(hash);
  });

  it("supports concurrent calls without shared state", async () => {
    const cases = [
      { str: "", seed: 0, expected: HASH_EMPTY },
      { str: "hello", seed: 0, expected: HASH_HELLO },
      { str: "hello", seed: 1, expected: HASH_HELLO_SEED_1 },
      { str: "0", seed: 0, expected: HASH_ZERO },
    ];

    const results = await Promise.all(
      cases.map((item) => Promise.resolve().then(() => cyrb53(item.str, item.seed))),
    );

    expect(results).toEqual(cases.map((item) => item.expected));
  });

  it("throws when input is null or undefined", () => {
    expect(() => cyrb53(null)).toThrow();
    expect(() => cyrb53(undefined)).toThrow();
  });
});

describe("computeContentHash", () => {
  it("hashes string inputs directly", () => {
    expect(computeContentHash("hello")).toBe(HASH_HELLO);
  });

  it("hashes numeric boundary values", () => {
    expect(computeContentHash(0)).toBe(HASH_ZERO);
    expect(computeContentHash(-1)).toBe(HASH_NEG_ONE);
    expect(computeContentHash(Number.MAX_SAFE_INTEGER)).toBe(HASH_MAX_SAFE);
  });

  it("handles empty and nullish values", () => {
    expect(computeContentHash("")).toBe(HASH_EMPTY);
    expect(computeContentHash(null)).toBe(HASH_NULL);
    expect(computeContentHash(undefined)).toBe(HASH_EMPTY);
    expect(computeContentHash([])).toBe(HASH_EMPTY_ARRAY);
    expect(computeContentHash({})).toBe(HASH_EMPTY_OBJECT);
  });

  it("handles whitespace-only strings", () => {
    expect(computeContentHash("   ")).toBe(HASH_WHITESPACE);
  });

  it("respects type boundaries for numeric strings and array-like objects", () => {
    expect(computeContentHash("123")).toBe(HASH_123);
    expect(computeContentHash(123)).toBe(HASH_123);

    const arrayLike = { 0: "a", length: 1 };
    const arrayValue = ["a"];
    const arrayLikeHash = computeContentHash(arrayLike);
    const arrayHash = computeContentHash(arrayValue);

    expect(arrayLikeHash).toMatch(HEX_REGEX);
    expect(arrayHash).toMatch(HEX_REGEX);
    expect(arrayLikeHash).not.toBe(arrayHash);
  });

  it("falls back when JSON.stringify throws", () => {
    const circular = {};
    circular.self = circular;

    expect(computeContentHash(circular)).toBe(HASH_OBJECT_STRING);
  });

  it("handles huge content strings deterministically", () => {
    const buffer = randomBytes(512 * 1024);
    const hugeString = buffer.toString("hex");
    const hash = computeContentHash(hugeString);

    expect(mockedCrypto.randomBytes).toHaveBeenCalledWith(512 * 1024);
    expect(hash).toMatch(HEX_REGEX);
    expect(computeContentHash(hugeString)).toBe(hash);
  });

  it("handles deep nested objects", () => {
    const root = {};
    let cursor = root;

    for (let i = 0; i < 200; i += 1) {
      cursor.next = { level: i };
      cursor = cursor.next;
    }

    const hash = computeContentHash(root);

    expect(hash).toMatch(HEX_REGEX);
    expect(computeContentHash(root)).toBe(hash);
  });

  it("supports concurrent calls", async () => {
    const inputs = [null, undefined, "", [], {}];

    const results = await Promise.all(
      inputs.map((value) => Promise.resolve().then(() => computeContentHash(value))),
    );

    expect(results).toEqual([
      HASH_NULL,
      HASH_EMPTY,
      HASH_EMPTY,
      HASH_EMPTY_ARRAY,
      HASH_EMPTY_OBJECT,
    ]);
  });

  it("supports rapid repeated calls", () => {
    const expected = computeContentHash("rapid");

    for (let i = 0; i < 100; i += 1) {
      expect(computeContentHash("rapid")).toBe(expected);
    }
  });
});
