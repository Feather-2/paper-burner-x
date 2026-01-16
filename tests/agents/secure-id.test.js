
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  cryptoRandomHex,
  cryptoRandomUuid,
  makeSecureId,
  makeSecureTimestampedId,
} from "../../js/agents/shared/utils/secure-id.js";

describe("shared/utils/secure-id", () => {
  describe("cryptoRandomHex", () => {
    it("generates 32-char hex by default (16 bytes)", () => {
      const hex = cryptoRandomHex();
      expect(hex.length).toBe(32);
      expect(/^[0-9a-f]+$/.test(hex)).toBeTruthy();
    });

    it("generates hex of specified byte length", () => {
      const hex = cryptoRandomHex(8);
      expect(hex.length).toBe(16);
    });

    it("generates different values each call", () => {
      const hex1 = cryptoRandomHex();
      const hex2 = cryptoRandomHex();
      expect(hex1).not.toBe(hex2);
    });

    it("handles non-number bytes", () => {
      const hex = cryptoRandomHex("invalid");
      // Falls back to 16 bytes
      expect(hex.length).toBe(32);
    });

    it("handles zero bytes (minimum 1)", () => {
      const hex = cryptoRandomHex(0);
      expect(hex.length).toBe(2);
    });

    it("handles negative bytes", () => {
      const hex = cryptoRandomHex(-5);
      expect(hex.length).toBe(2);
    });

    it("handles large byte count", () => {
      const hex = cryptoRandomHex(64);
      expect(hex.length).toBe(128);
    });
  });

  describe("cryptoRandomUuid", () => {
    it("generates valid UUID format", () => {
      const uuid = cryptoRandomUuid();
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-axxx-xxxxxxxxxxxx
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(uuidRegex.test(uuid)).toBeTruthy();
    });

    it("generates different UUIDs each call", () => {
      const uuid1 = cryptoRandomUuid();
      const uuid2 = cryptoRandomUuid();
      expect(uuid1).not.toBe(uuid2);
    });

    it("generates 36-character string", () => {
      const uuid = cryptoRandomUuid();
      expect(uuid.length).toBe(36);
    });
  });

  describe("makeSecureId", () => {
    it("generates id with default prefix", () => {
      const id = makeSecureId();
      expect(id.startsWith("id_")).toBeTruthy();
    });

    it("generates id with custom prefix", () => {
      const id = makeSecureId("session");
      expect(id.startsWith("session_")).toBeTruthy();
    });

    it("trims whitespace from prefix", () => {
      const id = makeSecureId("  user  ");
      expect(id.startsWith("user_")).toBeTruthy();
    });

    it("uses default prefix for empty string", () => {
      const id = makeSecureId("");
      expect(id.startsWith("id_")).toBeTruthy();
    });

    it("uses default prefix for non-string", () => {
      const id = makeSecureId(123);
      expect(id.startsWith("id_")).toBeTruthy();
    });

    it("generates different ids each call", () => {
      const id1 = makeSecureId("test");
      const id2 = makeSecureId("test");
      expect(id1).not.toBe(id2);
    });

    it("includes uuid after prefix", () => {
      const id = makeSecureId("agent");
      const uuidPart = id.slice("agent_".length);
      // Should be UUID format
      expect(uuidPart.length).toBe(36);
    });
  });

  describe("makeSecureTimestampedId", () => {
    it("generates id with default prefix", () => {
      const id = makeSecureTimestampedId();
      expect(id.startsWith("id_")).toBeTruthy();
    });

    it("generates id with custom prefix", () => {
      const id = makeSecureTimestampedId("run");
      expect(id.startsWith("run_")).toBeTruthy();
    });

    it("trims whitespace from prefix", () => {
      const id = makeSecureTimestampedId("  task  ");
      expect(id.startsWith("task_")).toBeTruthy();
    });

    it("uses default prefix for empty string", () => {
      const id = makeSecureTimestampedId("");
      expect(id.startsWith("id_")).toBeTruthy();
    });

    it("includes timestamp component", () => {
      const before = Date.now();
      const id = makeSecureTimestampedId("event");
      const after = Date.now();

      // Extract timestamp part (after prefix, before second underscore)
      const parts = id.split("_");
      expect(parts[0]).toBe("event");
      expect(parts.length >= 3).toBeTruthy();

      // Timestamp is base36 encoded
      const timestamp = parseInt(parts[1], 36);
      expect(timestamp >= before).toBeTruthy();
      expect(timestamp <= after).toBeTruthy();
    });

    it("includes random hex suffix", () => {
      const id = makeSecureTimestampedId("test");
      const parts = id.split("_");
      const randomPart = parts[2];
      // 8 bytes = 16 hex chars
      expect(randomPart.length).toBe(16);
      expect(/^[0-9a-f]+$/.test(randomPart)).toBeTruthy();
    });

    it("generates different ids each call", () => {
      const id1 = makeSecureTimestampedId("test");
      const id2 = makeSecureTimestampedId("test");
      expect(id1).not.toBe(id2);
    });
  });
});
