const test = require("node:test");
const assert = require("node:assert/strict");

test("Logger: setLogContext / getLogContext", async () => {
  const { setLogContext, getLogContext } = await import("../../../js/agents/stages/deepsearch/logger.js");

  setLogContext({ runId: "test_run", iteration: 1 });
  const ctx = getLogContext();
  assert.equal(ctx.runId, "test_run");
  assert.equal(ctx.iteration, 1);

  setLogContext({ iteration: 2 });
  const ctx2 = getLogContext();
  assert.equal(ctx2.runId, "test_run"); // runId 未变
  assert.equal(ctx2.iteration, 2);
});

test("Logger: enableLogging / isLoggingEnabled", async () => {
  const { enableLogging, isLoggingEnabled } = await import("../../../js/agents/stages/deepsearch/logger.js");

  // 默认启用
  assert.equal(isLoggingEnabled(), true);

  enableLogging(false);
  assert.equal(isLoggingEnabled(), false);

  enableLogging(true);
  assert.equal(isLoggingEnabled(), true);
});

test("Logger: logEvent with EventBus integration", async () => {
  const { logEvent, setLogContext, setEventBus, enableLogging } = await import("../../../js/agents/stages/deepsearch/logger.js");
  const { EventBus } = await import("../../../js/agents/runtime/event-bus.js");

  enableLogging(true);
  setLogContext({ runId: "test_run", iteration: 1 });

  const events = [];
  const bus = new EventBus({ runId: "test_run" });
  bus.on("*", (evt) => events.push(evt));
  setEventBus(bus);

  logEvent({
    stage: 'scan',
    message: 'Test scan event',
    data: { sourceCount: 5 },
  });

  // 验证 EventBus 事件
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'deepsearch.log.scan');
  assert.equal(events[0].actor, 'deepsearch.logger');
  assert.equal(events[0].payload.stage, 'scan');
  assert.equal(events[0].payload.message, 'Test scan event');
  assert.equal(events[0].payload.runId, 'test_run');
  assert.equal(events[0].payload.iteration, 1);
  assert.equal(events[0].payload.data.sourceCount, 5);
  assert.ok(events[0].payload.timestamp);
});

test("Logger: logEvent without EventBus (console fallback)", async () => {
  const { logEvent, setLogContext, setEventBus, enableLogging } = await import("../../../js/agents/stages/deepsearch/logger.js");

  enableLogging(true);
  setLogContext({ runId: "test_run_no_bus", iteration: 0 });
  setEventBus(null); // 清除 EventBus

  // 应该能正常调用，不抛出错误（降级到 console 输出）
  assert.doesNotThrow(() => {
    logEvent({
      stage: 'gaps',
      message: 'Test gaps without bus',
      data: { gapCount: 3 },
    });
  });
});

test("Logger: logEvent disabled", async () => {
  const { logEvent, enableLogging, setEventBus } = await import("../../../js/agents/stages/deepsearch/logger.js");
  const { EventBus } = await import("../../../js/agents/runtime/event-bus.js");

  enableLogging(false);

  const events = [];
  const bus = new EventBus({ runId: "test_run" });
  bus.on("*", (evt) => events.push(evt));
  setEventBus(bus);

  logEvent({
    stage: 'retrieve',
    message: 'Should not emit',
    data: {},
  });

  // 日志禁用时不应该发射事件
  assert.equal(events.length, 0);

  enableLogging(true); // 恢复
});

test("Logger: logEvent without stage field", async () => {
  const { logEvent, enableLogging, setLogContext } = await import("../../../js/agents/stages/deepsearch/logger.js");

  enableLogging(true);
  setLogContext({ runId: "test_run", iteration: 0 });

  // 缺少 stage 字段应该只输出警告，不抛出错误
  assert.doesNotThrow(() => {
    logEvent({
      message: 'No stage',
      data: {},
    });
  });
});

test("Logger: trackToolCall success", async () => {
  const { trackToolCall, enableLogging, setLogContext, setEventBus } = await import("../../../js/agents/stages/deepsearch/logger.js");
  const { EventBus } = await import("../../../js/agents/runtime/event-bus.js");

  enableLogging(true);
  setLogContext({ runId: "test_tool", iteration: 0 });

  const events = [];
  const bus = new EventBus({ runId: "test_tool" });
  bus.on("deepsearch.log.tool", (evt) => events.push(evt));
  setEventBus(bus);

  const mockResult = { count: 10 };
  const result = await trackToolCall('grep', { pattern: 'test' }, async () => mockResult);

  assert.equal(result, mockResult);
  assert.equal(events.length, 2); // 开始 + 完成

  // 开始事件
  assert.equal(events[0].payload.message, 'Tool call: grep');
  assert.equal(events[0].payload.data.tool, 'grep');
  assert.deepEqual(events[0].payload.data.args, { pattern: 'test' });

  // 完成事件
  assert.equal(events[1].payload.message, 'Tool completed: grep');
  assert.equal(events[1].payload.data.success, true);
  assert.ok(events[1].payload.data.duration >= 0);
  assert.equal(events[1].payload.toolCalls.length, 1);
  assert.equal(events[1].payload.toolCalls[0].tool, 'grep');
  assert.ok(events[1].payload.toolCalls[0].duration >= 0);
});

test("Logger: trackToolCall failure", async () => {
  const { trackToolCall, enableLogging, setLogContext, setEventBus } = await import("../../../js/agents/stages/deepsearch/logger.js");
  const { EventBus } = await import("../../../js/agents/runtime/event-bus.js");

  enableLogging(true);
  setLogContext({ runId: "test_tool_fail", iteration: 0 });

  const events = [];
  const bus = new EventBus({ runId: "test_tool_fail" });
  bus.on("deepsearch.log.tool", (evt) => events.push(evt));
  setEventBus(bus);

  const mockError = new Error("Tool failed");

  await assert.rejects(
    async () => {
      await trackToolCall('glob', { pattern: '*.js' }, async () => {
        throw mockError;
      });
    },
    { message: "Tool failed" }
  );

  assert.equal(events.length, 2); // 开始 + 失败

  // 失败事件
  assert.equal(events[1].payload.message, 'Tool failed: glob');
  assert.equal(events[1].payload.data.success, false);
  assert.equal(events[1].payload.data.error, 'Tool failed');
  assert.equal(events[1].payload.toolCalls[0].error, 'Tool failed');
});

test("Logger: trackToolCall with disabled logging", async () => {
  const { trackToolCall, enableLogging, setEventBus } = await import("../../../js/agents/stages/deepsearch/logger.js");
  const { EventBus } = await import("../../../js/agents/runtime/event-bus.js");

  enableLogging(false);

  const events = [];
  const bus = new EventBus({ runId: "test" });
  bus.on("*", (evt) => events.push(evt));
  setEventBus(bus);

  const mockResult = { data: 'test' };
  const result = await trackToolCall('read', { path: '/test' }, async () => mockResult);

  assert.equal(result, mockResult);
  assert.equal(events.length, 0); // 日志禁用，不应发射事件

  enableLogging(true); // 恢复
});

test("Logger: Payload format validation", async () => {
  const { logEvent, setLogContext, setEventBus, enableLogging } = await import("../../../js/agents/stages/deepsearch/logger.js");
  const { EventBus } = await import("../../../js/agents/runtime/event-bus.js");

  enableLogging(true);
  setLogContext({ runId: "test_format", iteration: 2 });

  const events = [];
  const bus = new EventBus({ runId: "test_format" });
  bus.on("*", (evt) => events.push(evt));
  setEventBus(bus);

  logEvent({
    stage: 'understand',
    message: 'Test format',
    data: { claimCount: 5 },
  });

  const payload = events[0].payload;

  // 验证必需字段
  assert.ok(payload.runId, 'payload must have runId');
  assert.ok(typeof payload.iteration === 'number', 'payload must have iteration (number)');
  assert.ok(payload.stage, 'payload must have stage');
  assert.ok(payload.timestamp, 'payload must have timestamp');

  // 验证字段值
  assert.equal(payload.runId, 'test_format');
  assert.equal(payload.iteration, 2);
  assert.equal(payload.stage, 'understand');
  assert.equal(payload.message, 'Test format');
  assert.deepEqual(payload.data, { claimCount: 5 });
});

test("Logger: Stage events (scan, gaps, retrieve, understand)", async () => {
  const { logEvent, setLogContext, setEventBus, enableLogging } = await import("../../../js/agents/stages/deepsearch/logger.js");
  const { EventBus } = await import("../../../js/agents/runtime/event-bus.js");

  enableLogging(true);
  setLogContext({ runId: "test_stages", iteration: 1 });

  const events = [];
  const bus = new EventBus({ runId: "test_stages" });
  // EventBus 不支持通配符，需要订阅具体事件
  const handler = (evt) => events.push(evt);
  bus.on("deepsearch.log.scan", handler);
  bus.on("deepsearch.log.gaps", handler);
  bus.on("deepsearch.log.retrieve", handler);
  bus.on("deepsearch.log.understand", handler);
  setEventBus(bus);

  // Scan
  logEvent({ stage: 'scan', message: 'Scan started', data: { sourceCount: 3 } });
  // Gaps
  logEvent({ stage: 'gaps', message: 'Gaps identified', data: { gapCount: 5 } });
  // Retrieve
  logEvent({ stage: 'retrieve', message: 'Retrieve completed', data: { retrievedCount: 10 } });
  // Understand
  logEvent({ stage: 'understand', message: 'Understanding', data: { claimCount: 8 } });

  assert.equal(events.length, 4);
  assert.equal(events[0].payload.stage, 'scan');
  assert.equal(events[1].payload.stage, 'gaps');
  assert.equal(events[2].payload.stage, 'retrieve');
  assert.equal(events[3].payload.stage, 'understand');
});

test("Logger: Tool chain tracking (grep → glob → read)", async () => {
  const { trackToolCall, enableLogging, setLogContext, setEventBus } = await import("../../../js/agents/stages/deepsearch/logger.js");
  const { EventBus } = await import("../../../js/agents/runtime/event-bus.js");

  enableLogging(true);
  setLogContext({ runId: "test_chain", iteration: 0 });

  const events = [];
  const bus = new EventBus({ runId: "test_chain" });
  bus.on("deepsearch.log.tool", (evt) => events.push(evt));
  setEventBus(bus);

  // 模拟工具链调用
  const grepResult = await trackToolCall('grep', { pattern: 'test' }, async () => ['file1.js', 'file2.js']);
  const globResult = await trackToolCall('glob', { pattern: '*.js' }, async () => ['file1.js', 'file2.js', 'file3.js']);
  const readResult = await trackToolCall('read', { path: 'file1.js' }, async () => 'content');

  assert.deepEqual(grepResult, ['file1.js', 'file2.js']);
  assert.deepEqual(globResult, ['file1.js', 'file2.js', 'file3.js']);
  assert.equal(readResult, 'content');

  // 每个工具调用应该生成 2 个事件（开始 + 完成）
  assert.equal(events.length, 6);

  // 验证事件序列
  assert.equal(events[0].payload.message, 'Tool call: grep');
  assert.equal(events[1].payload.message, 'Tool completed: grep');
  assert.equal(events[2].payload.message, 'Tool call: glob');
  assert.equal(events[3].payload.message, 'Tool completed: glob');
  assert.equal(events[4].payload.message, 'Tool call: read');
  assert.equal(events[5].payload.message, 'Tool completed: read');

  // 验证 toolCalls 记录
  assert.equal(events[1].payload.toolCalls.length, 1);
  assert.equal(events[1].payload.toolCalls[0].tool, 'grep');
  assert.equal(events[3].payload.toolCalls[0].tool, 'glob');
  assert.equal(events[5].payload.toolCalls[0].tool, 'read');
});

test("Logger: Legacy log methods (backward compatibility)", async () => {
  const { log, logError, enableLogging } = await import("../../../js/agents/stages/deepsearch/logger.js");

  enableLogging(true);

  // 这些方法应该能正常调用不抛出错误
  assert.doesNotThrow(() => {
    log('scan', 'Legacy log message');
    log('gaps', 'With data', { count: 5 });
    logError('retrieve', 'Error message');
    logError('understand', 'With error object', new Error('test error'));
  });
});

test("Logger: Condense and write stage events", async () => {
  const { logEvent, setLogContext, setEventBus, enableLogging, condenseLog, writeLog } = await import("../../../js/agents/stages/deepsearch/logger.js");
  const { EventBus } = await import("../../../js/agents/runtime/event-bus.js");

  enableLogging(true);
  setLogContext({ runId: "test_all_stages", iteration: 0 });

  const events = [];
  const bus = new EventBus({ runId: "test_all_stages" });
  // EventBus 不支持通配符，需要订阅具体事件
  const handler = (evt) => events.push(evt);
  bus.on("deepsearch.log.write", handler);
  bus.on("deepsearch.log.condense", handler);
  setEventBus(bus);

  // Write
  logEvent({ stage: 'write', message: 'Write started', data: {} });
  // Condense
  logEvent({ stage: 'condense', message: 'Condense started', data: {} });

  assert.equal(events.length, 2);
  assert.equal(events[0].payload.stage, 'write');
  assert.equal(events[1].payload.stage, 'condense');

  // Legacy 方法测试
  assert.doesNotThrow(() => {
    writeLog('Writing slides');
    condenseLog('Condensing memory');
  });
});

test("Logger: DeepSearch stage event", async () => {
  const { logEvent, setLogContext, setEventBus, enableLogging } = await import("../../../js/agents/stages/deepsearch/logger.js");
  const { EventBus } = await import("../../../js/agents/runtime/event-bus.js");

  enableLogging(true);
  setLogContext({ runId: "test_deepsearch", iteration: 0 });

  const events = [];
  const bus = new EventBus({ runId: "test_deepsearch" });
  bus.on("deepsearch.log.deepsearch", (evt) => events.push(evt));
  setEventBus(bus);

  logEvent({
    stage: 'deepsearch',
    message: 'Pipeline started',
    data: { maxIterations: 3 },
  });

  logEvent({
    stage: 'deepsearch',
    message: 'Iteration 1 started',
    data: { iteration: 1, openGaps: 5 },
  });

  logEvent({
    stage: 'deepsearch',
    message: 'Pipeline completed',
    data: { finalIteration: 2, slideCount: 10 },
  });

  assert.equal(events.length, 3);
  assert.equal(events[0].payload.message, 'Pipeline started');
  assert.equal(events[1].payload.message, 'Iteration 1 started');
  assert.equal(events[2].payload.message, 'Pipeline completed');
});
