// 快速验证 logger 功能（手动运行）
import { createLogger, trackToolCall, logEvent } from "../../../js/agents/stages/deepsearch/logger.js";

console.log("=== Logger 功能验证 ===\n");

const events = [];
const emit = (name, payload) => {
  events.push({ name, payload });
  console.log(`  - 收到事件: ${name}`);
};

const state = { runId: "verify_run", iteration: 1, stage: "scan" };
const logger = createLogger({
  emit,
  getContext: () => ({ runId: state.runId, iteration: state.iteration, stage: state.stage }),
});

console.log("1. 测试基础日志事件");
logger.info("Test scan event", { data: { sourceCount: 3 } });
console.log(`✓ 发射了 ${events.length} 个事件\n`);

console.log("2. 测试工具调用追踪");
const mockTool = async () => ({ count: 10 });
const result = await trackToolCall(logger, "grep", { pattern: "test" }, mockTool);
console.log("✓ 工具调用完成，结果:", result);
console.log(`✓ 总共发射了 ${events.length} 个事件\n`);

console.log("3. 验证 Payload 格式");
const last = events[events.length - 1]?.payload || {};
const hasRunId = !!last.runId;
const hasIteration = typeof last.iteration === "number";
const hasStage = !!last.stage;
const hasTimestamp = !!last.timestamp;
console.log(`  - runId: ${hasRunId ? "✓" : "✗"}`);
console.log(`  - iteration: ${hasIteration ? "✓" : "✗"}`);
console.log(`  - stage: ${hasStage ? "✓" : "✗"}`);
console.log(`  - timestamp: ${hasTimestamp ? "✓" : "✗"}`);

console.log("\n4. deprecated logEvent");
logEvent({ message: "legacy event" });

if (hasRunId && hasIteration && hasStage && hasTimestamp) {
  console.log("\n✅ 所有验证通过！Logger 功能正常。");
} else {
  console.log("\n❌ 验证失败！部分字段缺失。");
  process.exit(1);
}

