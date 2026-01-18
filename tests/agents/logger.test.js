
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  createLogger,
  useLogger,
  trackToolCall,
  logEvent,
} from "../../js/agents/shared/utils/logger.js";

describe("shared/utils/logger", () => {
  describe("createLogger", () => {
    it("creates logger with default options", () => {
      const logger = createLogger();
      expect(logger).toEqual(expect.any(Object));
      expect(logger.debug).toBeTypeOf("function");
      expect(logger.info).toBeTypeOf("function");
      expect(logger.warn).toBeTypeOf("function");
      expect(logger.error).toBeTypeOf("function");
    });

    it("accepts string as stage name", () => {
      const logger = createLogger("my-stage");
      expect(logger.info).toBeTypeOf("function");
    });

    it("logs with emit function", () => {
      const emitted = [];
      const logger = createLogger({
        emit: (event, payload) => emitted.push({ event, payload }),
        stage: "test",
      });

      logger.info("test message", { extra: "data" });

      expect(emitted.length).toBe(1);
      expect(emitted[0].event).toContain("log.info");
      expect(emitted[0].payload.message).toBe("test message");
    });

    it("logs error with failed status", () => {
      const emitted = [];
      const logger = createLogger({
        emit: (event, payload, meta) => emitted.push({ event, payload, meta }),
        stage: "test",
      });

      logger.error("error message");

      expect(emitted.length).toBe(1);
      expect(emitted[0].meta.status).toBe("failed");
    });

    it("uses getContext function", () => {
      const emitted = [];
      const logger = createLogger({
        emit: (event, payload) => emitted.push(payload),
        getContext: () => ({ requestId: "abc123" }),
        stage: "test",
      });

      logger.info("with context");

      expect(emitted[0].requestId).toBe("abc123");
    });

    it("does not log when disabled", () => {
      const emitted = [];
      const logger = createLogger({
        emit: (event, payload) => emitted.push(payload),
        enabled: false,
      });

      logger.info("should not emit");

      expect(emitted.length).toBe(0);
    });

    it("handles null getContext", () => {
      const emitted = [];
      const logger = createLogger({
        emit: (event, payload) => emitted.push(payload),
        getContext: null,
      });

      logger.info("message");
      expect(emitted).toHaveLength(1);
    });

    it("handles getContext returning non-object", () => {
      const emitted = [];
      const logger = createLogger({
        emit: (event, payload) => emitted.push(payload),
        getContext: () => "not an object",
        stage: "test",
      });

      logger.info("message");
      expect(emitted[0].message).toBe("message");
    });

    it("handles null options", () => {
      const logger = createLogger(null);
      expect(logger.info).toBeTypeOf("function");
    });

    it("uses custom actor name", () => {
      const emitted = [];
      const logger = createLogger({
        emit: (event) => emitted.push(event),
        actor: "custom-actor",
      });

      logger.info("test");

      expect(emitted[0]).toContain("custom-actor");
    });

    it("handles data as non-object", () => {
      const emitted = [];
      const logger = createLogger({
        emit: (event, payload) => emitted.push(payload),
      });

      logger.info("message", "string data");
      expect(emitted[0]).toEqual(
        expect.objectContaining({ level: "info", message: "message" })
      );
    });
  });

  describe("useLogger", () => {
    it("is alias for createLogger", () => {
      expect(useLogger).toBe(createLogger);
    });
  });

  describe("trackToolCall", () => {
    it("executes function and returns result", async () => {
      const logger = createLogger({ enabled: false });
      const result = await trackToolCall(logger, "testTool", { arg: 1 }, () => 42);
      expect(result).toBe(42);
    });

    it("logs tool call and completion", async () => {
      const logs = [];
      const logger = {
        info: (msg, data) => logs.push({ level: "info", msg, data }),
        error: (msg, data) => logs.push({ level: "error", msg, data }),
      };

      await trackToolCall(logger, "myTool", { x: 1 }, async () => "result");

      expect(logs.length).toBe(2);
      expect(logs[0].msg).toContain("myTool");
      expect(logs[1].msg).toContain("completed");
    });

    it("logs error on failure", async () => {
      const logs = [];
      const logger = {
        info: (msg, data) => logs.push({ level: "info", msg, data }),
        error: (msg, data) => logs.push({ level: "error", msg, data }),
      };

      await expect(
        trackToolCall(logger, "failTool", {}, async () => {
          throw new Error("tool failed");
        })
      ).rejects.toThrow(/tool failed/);

      const errorLog = logs.find((l) => l.level === "error");
      expect(errorLog).toEqual(expect.objectContaining({ level: "error" }));
      expect(errorLog.msg).toContain("failed");
    });

    it("returns result without logger", async () => {
      const result = await trackToolCall(null, "tool", {}, () => "value");
      expect(result).toBe("value");
    });

    it("returns result with invalid logger", async () => {
      const result = await trackToolCall({}, "tool", {}, () => 123);
      expect(result).toBe(123);
    });

    it("handles array result", async () => {
      const logs = [];
      const logger = {
        info: (msg, data) => logs.push({ level: "info", msg, data }),
        error: () => {},
      };

      const result = await trackToolCall(logger, "arrayTool", {}, async () => [1, 2, 3]);

      expect(result).toEqual([1, 2, 3]);
      const completionLog = logs.find((l) => l.msg.includes("completed"));
      expect(completionLog.data.toolCalls[0].result.length).toBe(3);
    });

    it("handles non-object result", async () => {
      const logs = [];
      const logger = {
        info: (msg, data) => logs.push({ level: "info", msg, data }),
        error: () => {},
      };

      await trackToolCall(logger, "primitiveTool", {}, async () => "string result");

      const completionLog = logs.find((l) => l.msg.includes("completed"));
      expect(completionLog.data.toolCalls[0].result).toBe("string result");
    });
  });

  describe("logEvent", () => {
    it("logs message from payload", () => {
      // Just verify it doesn't throw
      logEvent({ message: "test" });
    });

    it("logs raw value if no message", () => {
      logEvent("raw string");
    });

    it("handles null payload", () => {
      logEvent(null);
    });
  });
});
