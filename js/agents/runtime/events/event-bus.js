/**
 * EventBus - 兼容层
 *
 * 重新导出 core/event-bus，保持旧代码兼容
 */

// 重新导出统一的 EventBus
export {
  EventBus,
  createEventRecord,
  isValidEventName,
  matchPattern,
  LamportClock,
} from '../../core/event-bus.js';

export { EventBus as default } from '../../core/event-bus.js';

// 兼容旧的 createEventId
export { createEventRecord as createEventId } from '../../core/event-bus.js';

// 重新导出 matchEventPattern（兼容旧名称）
export { matchPattern as matchEventPattern } from '../../core/event-bus.js';
