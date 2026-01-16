import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

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
      assert.ok(logger);
      assert.ok(typeof logger.debug === "function");
      assert.ok(typeof logger.info === "function");
      assert.ok(typeof logger.warn === "function");
      assert.ok(typeof logger.error === "function");
    });

    it("accepts string as stage name", () => {
      const logger = createLogger("my-stage");
      assert.ok(logger);
    });

    it("logs with emit function", () => {
      const emitted = [];
      const logger = createLogger({
        emit: (event, payload) => emitted.push({ event, payload }),
        stage: "test",
      });

      logger.info("test message", { extra: "data" });

      assert.equal(emitted.length, 1);
      assert.ok(emitted[0].event.includes("log.info"));
      assert.equal(emitted[0].payload.message, "test message");
    });

    it("logs error with failed status", () => {
      const emitted = [];
      const logger = createLogger({
        emit: (event, payload, meta) => emitted.push({ event, payload, meta }),
        stage: "test",
      });

      logger.error("error message");

      assert.equal(emitted.length, 1);
      assert.equal(emitted[0].meta.status, "failed");
    });

    it("uses getContext function", () => {
      const emitted = [];
      const logger = createLogger({
        emit: (event, payload) => emitted.push(payload),
        getContext: () => ({ requestId: "abc123" }),
        stage: "test",
      });

      logger.info("with context");

      assert.equal(emitted[0].requestId, "abc123");
    });

    it("does not log when disabled", () => {
      const emitted = [];
      const logger = createLogger({
        emit: (event, payload) => emitted.push(payload),
        enabled: false,
      });

      logger.info("should not emit");

      assert.equal(emitted.length, 0);
    });

    it("handles null getContext", () => {
      const emitted = [];
      const logger = createLogger({
        emit: (event, payload) => emitted.push(payload),
        getContext: null,
      });

      logger.info("message");
      assert.ok(emitted.length === 1);
    });

    it("handles getContext returning non-object", () => {
      const emitted = [];
      const logger = createLogger({
        emit: (event, payload) => emitted.push(payload),
        getContext: () => "not an object",
        stage: "test",
      });

      logger.info("message");
      assert.ok(emitted[0].message === "message");
    });

    it("handles null options", () => {
      const logger = createLogger(null);
      assert.ok(logger);
    });

    it("uses custom actor name", () => {
      const emitted = [];
      const logger = createLogger({
        emit: (event) => emitted.push(event),
        actor: "custom-actor",
      });

      logger.info("test");

      assert.ok(emitted[0].includes("custom-actor"));
    });

    it("handles data as non-object", () => {
      const emitted = [];
      const logger = createLogger({
        emit: (event, payload) => emitted.push(payload),
      });

      logger.info("message", "string data");
      assert.ok(emitted[0]);
    });
  });

  describe("useLogger", () => {
    it("is alias for createLogger", () => {
      assert.equal(useLogger, createLogger);
    });
  });

  describe("trackToolCall", () => {
    it("executes function and returns result", async () => {
      const logger = createLogger({ enabled: false });
      const result = await trackToolCall(logger, "testTool", { arg: 1 }, () => 42);
      assert.equal(result, 42);
    });

    it("logs tool call and completion", async () => {
      const logs = [];
      const logger = {
        info: (msg, data) => logs.push({ level: "info", msg, data }),
        error: (msg, data) => logs.push({ level: "error", msg, data }),
      };

      await trackToolCall(logger, "myTool", { x: 1 }, async () => "result");

      assert.equal(logs.length, 2);
      assert.ok(logs[0].msg.includes("myTool"));
      assert.ok(logs[1].msg.includes("completed"));
    });

    it("logs error on failure", async () => {
      const logs = [];
      const logger = {
        info: (msg, data) => logs.push({ level: "info", msg, data }),
        error: (msg, data) => logs.push({ level: "error", msg, data }),
      };

      await assert.rejects(
        () => trackToolCall(logger, "failTool", {}, async () => {
          throw new Error("tool failed");
        }),
        /tool failed/
      );

      const errorLog = logs.find((l) => l.level === "error");
      assert.ok(errorLog);
      assert.ok(errorLog.msg.includes("failed"));
    });

    it("returns result without logger", async () => {
      const result = await trackToolCall(null, "tool", {}, () => "value");
      assert.equal(result, "value");
    });

    it("returns result with invalid logger", async () => {
      const result = await trackToolCall({}, "tool", {}, () => 123);
      assert.equal(result, 123);
    });

    it("handles array result", async () => {
      const logs = [];
      const logger = {
        info: (msg, data) => logs.push({ level: "info", msg, data }),
        error: () => {},
      };

      const result = await trackToolCall(logger, "arrayTool", {}, async () => [1, 2, 3]);

      assert.deepEqual(result, [1, 2, 3]);
      const completionLog = logs.find((l) => l.msg.includes("completed"));
      assert.ok(completionLog.data.toolCalls[0].result.length === 3);
    });

    it("handles non-object result", async () => {
      const logs = [];
      const logger = {
        info: (msg, data) => logs.push({ level: "info", msg, data }),
        error: () => {},
      };

      await trackToolCall(logger, "primitiveTool", {}, async () => "string result");

      const completionLog = logs.find((l) => l.msg.includes("completed"));
      assert.equal(completionLog.data.toolCalls[0].result, "string result");
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
