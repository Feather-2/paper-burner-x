// 快速验证 logger 功能
import { logEvent, setLogContext, setEventBus, enableLogging, trackToolCall } from '../../../js/agents/stages/deepsearch/logger.js';
import { EventBus } from '../../../js/agents/runtime/event-bus.js';

console.log('=== Logger 功能验证 ===\n');

// 1. 上下文设置
console.log('1. 测试上下文设置');
setLogContext({ runId: 'verify_run', iteration: 1 });
console.log('✓ 上下文已设置\n');

// 2. EventBus 集成
console.log('2. 测试 EventBus 集成');
const bus = new EventBus({ runId: 'verify_run' });
const events = [];
bus.on('*', (evt) => {
  events.push(evt);
  console.log(`  - 收到事件: ${evt.name}, actor: ${evt.actor}`);
});
setEventBus(bus);
console.log('✓ EventBus 已设置\n');

// 3. 基础日志
console.log('3. 测试基础日志事件');
logEvent({
  stage: 'scan',
  message: 'Test scan event',
  data: { sourceCount: 3 }
});
console.log(`✓ 发射了 ${events.length} 个事件\n`);

// 4. 工具调用追踪
console.log('4. 测试工具调用追踪');
const mockTool = async () => {
  return { count: 10 };
};
const result = await trackToolCall('grep', { pattern: 'test' }, mockTool);
console.log(`✓ 工具调用完成，结果:`, result);
console.log(`✓ 总共发射了 ${events.length} 个事件\n`);

// 5. Payload 格式验证
console.log('5. 验证 Payload 格式');
const lastEvent = events[events.length - 1];
const payload = lastEvent.payload;
const hasRunId = !!payload.runId;
const hasIteration = typeof payload.iteration === 'number';
const hasStage = !!payload.stage;
const hasTimestamp = !!payload.timestamp;
console.log(`  - runId: ${hasRunId ? '✓' : '✗'}`);
console.log(`  - iteration: ${hasIteration ? '✓' : '✗'}`);
console.log(`  - stage: ${hasStage ? '✓' : '✗'}`);
console.log(`  - timestamp: ${hasTimestamp ? '✓' : '✗'}`);

if (hasRunId && hasIteration && hasStage && hasTimestamp) {
  console.log('\n✅ 所有验证通过！Logger 功能正常。');
} else {
  console.log('\n❌ 验证失败！部分字段缺失。');
  process.exit(1);
}
