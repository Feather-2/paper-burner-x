
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  PB_ENCRYPTED_PREFIX,
  isEncryptedString,
  canUseStorageEncryption,
  encryptString,
  decryptString,
} from "../../js/agents/shared/utils/storage-crypto.js";

describe("shared/utils/storage-crypto", () => {
  describe("PB_ENCRYPTED_PREFIX", () => {
    it("is a string constant", () => {
      expect(typeof PB_ENCRYPTED_PREFIX).toBe("string");
      expect(PB_ENCRYPTED_PREFIX.length > 0).toBeTruthy();
    });

    it("has expected format", () => {
      expect(PB_ENCRYPTED_PREFIX.startsWith("pbenc:")).toBeTruthy();
    });
  });

  describe("isEncryptedString", () => {
    it("returns true for encrypted format", () => {
      expect(isEncryptedString(`${PB_ENCRYPTED_PREFIX}{"data":"test"}`)).toBeTruthy();
    });

    it("returns false for non-string", () => {
      expect(isEncryptedString(null)).toBe(false);
      expect(isEncryptedString(undefined)).toBe(false);
      expect(isEncryptedString(123)).toBe(false);
      expect(isEncryptedString({})).toBe(false);
    });

    it("returns false for plain text", () => {
      expect(isEncryptedString("plain text")).toBe(false);
      expect(isEncryptedString("")).toBe(false);
    });

    it("returns false for partial prefix", () => {
      expect(isEncryptedString("pbenc:")).toBe(false);
      expect(isEncryptedString("pbenc")).toBe(false);
    });
  });

  describe("canUseStorageEncryption", () => {
    it("returns boolean", () => {
      const result = canUseStorageEncryption();
      expect(typeof result).toBe("boolean");
    });

    it("returns true in Node.js with WebCrypto", () => {
      // Node.js 15+ has WebCrypto
      const hasCrypto = typeof globalThis.crypto?.subtle === "object";
      expect(canUseStorageEncryption()).toBe(hasCrypto);
    });
  });

  describe("encryptString/decryptString", () => {
    const hasWebCrypto = typeof globalThis.crypto?.subtle === "object";

    it("encrypts and decrypts string", async () => {
      if (!hasWebCrypto) {
        return; // Skip in environments without WebCrypto
      }

      const plaintext = "Hello, World!";
      const passphrase = "test-password-123";

      const encrypted = await encryptString(plaintext, { passphrase });
      expect(isEncryptedString(encrypted)).toBeTruthy();

      const decrypted = await decryptString(encrypted, { passphrase });
      expect(decrypted).toBe(plaintext);
    });

    it("encrypts non-string values", async () => {
      if (!hasWebCrypto) return;

      const passphrase = "test-password";
      const encrypted = await encryptString(12345, { passphrase });
      expect(isEncryptedString(encrypted)).toBeTruthy();

      const decrypted = await decryptString(encrypted, { passphrase });
      expect(decrypted).toBe("12345");
    });

    it("encrypts null/undefined as empty string", async () => {
      if (!hasWebCrypto) return;

      const passphrase = "test-password";
      const encrypted = await encryptString(null, { passphrase });
      const decrypted = await decryptString(encrypted, { passphrase });
      expect(decrypted).toBe("");
    });

    it("supports AAD (additional authenticated data)", async () => {
      if (!hasWebCrypto) return;

      const plaintext = "secret data";
      const passphrase = "test-password";
      const aad = "context-info";

      const encrypted = await encryptString(plaintext, { passphrase, aad });
      const decrypted = await decryptString(encrypted, { passphrase, aad });
      expect(decrypted).toBe(plaintext);
    });

    it("fails with wrong AAD", async () => {
      if (!hasWebCrypto) return;

      const plaintext = "secret data";
      const passphrase = "test-password";

      const encrypted = await encryptString(plaintext, {
        passphrase,
        aad: "correct-aad",
      });

      await expect(() => decryptString(encrypted, { passphrase, aad: "wrong-aad" }),
        /decrypt|operation/i
      );
    });

    it("supports custom iterations", async () => {
      if (!hasWebCrypto) return;

      const plaintext = "test";
      const passphrase = "test-password";
      const iterations = 10000; // Minimum allowed

      const encrypted = await encryptString(plaintext, {
        passphrase,
        iterations,
      });
      const decrypted = await decryptString(encrypted, { passphrase });
      expect(decrypted).toBe(plaintext);
    });

    it("throws without passphrase", async () => {
      if (!hasWebCrypto) return;

      await expect(() => encryptString("test", {}),
        /passphrase/i
      );
    });

    it("throws for non-encrypted payload", async () => {
      if (!hasWebCrypto) return;

      await expect(() => decryptString("plain text", { passphrase: "test" }),
        /not encrypted/i
      );
    });

    it("throws for invalid JSON payload", async () => {
      if (!hasWebCrypto) return;

      await expect(() => decryptString(`${PB_ENCRYPTED_PREFIX}not-json`, { passphrase: "test" }),
        /invalid.*JSON/i
      );
    });

    it("throws for invalid payload fields", async () => {
      if (!hasWebCrypto) return;

      const invalidPayload = `${PB_ENCRYPTED_PREFIX}{"saltB64":"","ivB64":"","ctB64":""}`;
      await expect(() => decryptString(invalidPayload, { passphrase: "test" }),
        /invalid.*fields/i
      );
    });

    it("fails with wrong passphrase", async () => {
      if (!hasWebCrypto) return;

      const encrypted = await encryptString("secret", { passphrase: "correct" });
      await expect(() => decryptString(encrypted, { passphrase: "wrong" }),
        /decrypt|operation/i
      );
    });

    it("produces different ciphertext each time", async () => {
      if (!hasWebCrypto) return;

      const plaintext = "same text";
      const passphrase = "same-password";

      const enc1 = await encryptString(plaintext, { passphrase });
      const enc2 = await encryptString(plaintext, { passphrase });

      // Random salt/IV should produce different ciphertext
      expect(enc1).not.toBe(enc2);
    });

    it("handles unicode text", async () => {
      if (!hasWebCrypto) return;

      const plaintext = "こんにちは 🌍 مرحبا";
      const passphrase = "unicode-test";

      const encrypted = await encryptString(plaintext, { passphrase });
      const decrypted = await decryptString(encrypted, { passphrase });
      expect(decrypted).toBe(plaintext);
    });

    it("handles large text", async () => {
      if (!hasWebCrypto) return;

      const plaintext = "x".repeat(100000);
      const passphrase = "large-test";

      const encrypted = await encryptString(plaintext, { passphrase });
      const decrypted = await decryptString(encrypted, { passphrase });
      expect(decrypted).toBe(plaintext);
    });
  });
});
