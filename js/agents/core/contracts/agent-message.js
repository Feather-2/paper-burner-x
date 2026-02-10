/**
 * Agent Message Contracts - 多 Agent 通信协议
 *
 * 定义跨 Agent 标准消息格式，用于 MessageBus 通信：
 * - task-request: 请求另一个 Agent 执行任务
 * - task-result: 任务执行结果
 * - status-update: Agent 状态广播
 * - knowledge-share: 知识共享（发现的信息传递给其他 Agent）
 *
 * 设计原则：
 * - 与 rpc-message.js 互补（RPC 是底层传输，agent-message 是应用协议）
 * - 每个消息携带 agentId 发送方标识
 * - task-request 使用 domain:action 格式的 taskType
 * - 所有 validate 返回 { ok, value } | { ok: false, error }
 */

// ─── 常量 ───────────────────────────────────────────────

/** @type {readonly ['task-request', 'task-result', 'status-update', 'knowledge-share']} */
export const AgentMessageKind = /** @type {const} */ ([
  'task-request',
  'task-result',
  'status-update',
  'knowledge-share',
]);

/** @type {readonly ['pending', 'running', 'completed', 'failed', 'cancelled']} */
export const TaskStatus = /** @type {const} */ ([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

/** @type {readonly ['idle', 'busy', 'degraded', 'stopping', 'stopped']} */
export const AgentRunStatus = /** @type {const} */ ([
  'idle',
  'busy',
  'degraded',
  'stopping',
  'stopped',
]);

const TASK_TYPE_PATTERN = /^[a-z][a-zA-Z0-9]*:[a-z][a-zA-Z0-9]*$/;

// ─── 类型定义 ───────────────────────────────────────────

/**
 * @typedef {{ ok: true, value: T }} ValidResult
 * @template T
 */

/**
 * @typedef {{ ok: false, error: string }} InvalidResult
 */

/**
 * @typedef {ValidResult<T> | InvalidResult} ValidationResult
 * @template T
 */

/**
 * @typedef {Object} TaskRequest
 * @property {'task-request'} kind
 * @property {string} agentId - 发送方 Agent ID
 * @property {string} [targetAgentId] - 目标 Agent ID（可选，广播时省略）
 * @property {string} taskType - domain:action 格式
 * @property {unknown} payload - 任务参数
 * @property {string} [correlationId] - 关联 ID（用于追踪）
 * @property {number} [priority] - 优先级 (0=最高, 默认 5)
 * @property {number} [timeoutMs] - 超时毫秒
 * @property {number} ts - 时间戳
 */

/**
 * @typedef {Object} TaskResult
 * @property {'task-result'} kind
 * @property {string} agentId - 发送方 Agent ID
 * @property {string} correlationId - 对应 TaskRequest 的 correlationId
 * @property {typeof TaskStatus[number]} status - 任务状态
 * @property {unknown} [data] - 返回数据
 * @property {string} [error] - 错误信息
 * @property {number} [durationMs] - 执行耗时
 * @property {number} ts - 时间戳
 */

/**
 * @typedef {Object} StatusUpdate
 * @property {'status-update'} kind
 * @property {string} agentId - 发送方 Agent ID
 * @property {typeof AgentRunStatus[number]} status - Agent 运行状态
 * @property {string} [currentTask] - 当前任务描述
 * @property {number} [progress] - 进度百分比 (0-100)
 * @property {Record<string, unknown>} [meta] - 附加元数据
 * @property {number} ts - 时间戳
 */

/**
 * @typedef {Object} KnowledgeShare
 * @property {'knowledge-share'} kind
 * @property {string} agentId - 发送方 Agent ID
 * @property {string} [targetAgentId] - 目标 Agent ID（可选）
 * @property {string} topic - 知识主题
 * @property {unknown} content - 知识内容
 * @property {string} [contentType] - 内容类型 (text/json/reference)
 * @property {string} [correlationId] - 关联 ID
 * @property {number} ts - 时间戳
 */

/**
 * @typedef {TaskRequest | TaskResult | StatusUpdate | KnowledgeShare} AgentMessage
 */

// ─── 内部工具 ───────────────────────────────────────────

/**
 * @param {unknown} v
 * @returns {string | null}
 */
function str(v) {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/**
 * @param {unknown} v
 * @returns {Record<string, unknown> | null}
 */
function obj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? /** @type {Record<string, unknown>} */ (v)
    : null;
}

/**
 * @param {unknown} v
 * @param {number} def
 * @returns {number}
 */
function num(v, def) {
  return typeof v === 'number' && Number.isFinite(v) ? v : def;
}

// ─── 验证函数 ───────────────────────────────────────────

/**
 * 验证 TaskRequest
 * @param {unknown} msg
 * @returns {ValidationResult<TaskRequest>}
 */
export function validateTaskRequest(msg) {
  const o = obj(msg);
  if (!o) return { ok: false, error: 'TaskRequest: expected object' };

  const agentId = str(o.agentId);
  if (!agentId) return { ok: false, error: 'TaskRequest.agentId: required non-empty string' };

  const taskType = str(o.taskType);
  if (!taskType) return { ok: false, error: 'TaskRequest.taskType: required non-empty string' };
  if (!TASK_TYPE_PATTERN.test(taskType)) {
    return { ok: false, error: 'TaskRequest.taskType: must be domain:action format (e.g. "search:execute")' };
  }

  const priority = num(o.priority, 5);
  if (priority < 0 || priority > 10) {
    return { ok: false, error: 'TaskRequest.priority: must be 0-10' };
  }

  const timeoutMs = o.timeoutMs !== undefined ? num(o.timeoutMs, -1) : undefined;
  if (timeoutMs !== undefined && timeoutMs <= 0) {
    return { ok: false, error: 'TaskRequest.timeoutMs: must be positive' };
  }

  return {
    ok: true,
    value: {
      kind: 'task-request',
      agentId,
      ...(str(o.targetAgentId) ? { targetAgentId: str(o.targetAgentId) } : {}),
      taskType,
      payload: o.payload,
      ...(str(o.correlationId) ? { correlationId: str(o.correlationId) } : {}),
      priority,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ts: num(o.ts, Date.now()),
    },
  };
}

/**
 * 验证 TaskResult
 * @param {unknown} msg
 * @returns {ValidationResult<TaskResult>}
 */
export function validateTaskResult(msg) {
  const o = obj(msg);
  if (!o) return { ok: false, error: 'TaskResult: expected object' };

  const agentId = str(o.agentId);
  if (!agentId) return { ok: false, error: 'TaskResult.agentId: required non-empty string' };

  const correlationId = str(o.correlationId);
  if (!correlationId) return { ok: false, error: 'TaskResult.correlationId: required non-empty string' };

  const status = str(o.status);
  if (!status || !TaskStatus.includes(/** @type {any} */ (status))) {
    return { ok: false, error: `TaskResult.status: must be one of ${TaskStatus.join(', ')}` };
  }

  return {
    ok: true,
    value: {
      kind: 'task-result',
      agentId,
      correlationId,
      status: /** @type {typeof TaskStatus[number]} */ (status),
      ...(o.data !== undefined ? { data: o.data } : {}),
      ...(typeof o.error === 'string' ? { error: o.error } : {}),
      ...(typeof o.durationMs === 'number' ? { durationMs: o.durationMs } : {}),
      ts: num(o.ts, Date.now()),
    },
  };
}

/**
 * 验证 StatusUpdate
 * @param {unknown} msg
 * @returns {ValidationResult<StatusUpdate>}
 */
export function validateStatusUpdate(msg) {
  const o = obj(msg);
  if (!o) return { ok: false, error: 'StatusUpdate: expected object' };

  const agentId = str(o.agentId);
  if (!agentId) return { ok: false, error: 'StatusUpdate.agentId: required non-empty string' };

  const status = str(o.status);
  if (!status || !AgentRunStatus.includes(/** @type {any} */ (status))) {
    return { ok: false, error: `StatusUpdate.status: must be one of ${AgentRunStatus.join(', ')}` };
  }

  const progress = o.progress !== undefined ? num(o.progress, -1) : undefined;
  if (progress !== undefined && (progress < 0 || progress > 100)) {
    return { ok: false, error: 'StatusUpdate.progress: must be 0-100' };
  }

  return {
    ok: true,
    value: {
      kind: 'status-update',
      agentId,
      status: /** @type {typeof AgentRunStatus[number]} */ (status),
      ...(str(o.currentTask) ? { currentTask: str(o.currentTask) } : {}),
      ...(progress !== undefined ? { progress } : {}),
      ...(obj(o.meta) ? { meta: obj(o.meta) } : {}),
      ts: num(o.ts, Date.now()),
    },
  };
}

/**
 * 验证 KnowledgeShare
 * @param {unknown} msg
 * @returns {ValidationResult<KnowledgeShare>}
 */
export function validateKnowledgeShare(msg) {
  const o = obj(msg);
  if (!o) return { ok: false, error: 'KnowledgeShare: expected object' };

  const agentId = str(o.agentId);
  if (!agentId) return { ok: false, error: 'KnowledgeShare.agentId: required non-empty string' };

  const topic = str(o.topic);
  if (!topic) return { ok: false, error: 'KnowledgeShare.topic: required non-empty string' };

  if (o.content === undefined || o.content === null) {
    return { ok: false, error: 'KnowledgeShare.content: required' };
  }

  const contentType = str(o.contentType);
  if (contentType && !['text', 'json', 'reference'].includes(contentType)) {
    return { ok: false, error: 'KnowledgeShare.contentType: must be text/json/reference' };
  }

  return {
    ok: true,
    value: {
      kind: 'knowledge-share',
      agentId,
      ...(str(o.targetAgentId) ? { targetAgentId: str(o.targetAgentId) } : {}),
      topic,
      content: o.content,
      ...(contentType ? { contentType } : {}),
      ...(str(o.correlationId) ? { correlationId: str(o.correlationId) } : {}),
      ts: num(o.ts, Date.now()),
    },
  };
}

/**
 * 通用 Agent 消息验证 — 根据 kind 字段分派
 * @param {unknown} msg
 * @returns {ValidationResult<AgentMessage>}
 */
export function validateAgentMessage(msg) {
  const o = obj(msg);
  if (!o) return { ok: false, error: 'AgentMessage: expected object' };

  const kind = str(o.kind);
  if (!kind || !AgentMessageKind.includes(/** @type {any} */ (kind))) {
    return { ok: false, error: `AgentMessage.kind: must be one of ${AgentMessageKind.join(', ')}` };
  }

  switch (kind) {
    case 'task-request': return validateTaskRequest(o);
    case 'task-result': return validateTaskResult(o);
    case 'status-update': return validateStatusUpdate(o);
    case 'knowledge-share': return validateKnowledgeShare(o);
    default:
      return { ok: false, error: `AgentMessage.kind: unknown kind "${kind}"` };
  }
}

// ─── 工厂函数（便捷创建） ─────────────────────────────────

/**
 * 创建 TaskRequest
 * @param {string} agentId
 * @param {string} taskType - domain:action 格式
 * @param {unknown} payload
 * @param {Partial<Omit<TaskRequest, 'kind' | 'agentId' | 'taskType' | 'payload' | 'ts'>>} [opts]
 * @returns {TaskRequest}
 */
export function createTaskRequest(agentId, taskType, payload, opts = {}) {
  return {
    kind: 'task-request',
    agentId,
    ...(opts.targetAgentId ? { targetAgentId: opts.targetAgentId } : {}),
    taskType,
    payload,
    ...(opts.correlationId ? { correlationId: opts.correlationId } : {}),
    priority: opts.priority ?? 5,
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    ts: Date.now(),
  };
}

/**
 * 创建 TaskResult
 * @param {string} agentId
 * @param {string} correlationId
 * @param {typeof TaskStatus[number]} status
 * @param {Partial<Pick<TaskResult, 'data' | 'error' | 'durationMs'>>} [opts]
 * @returns {TaskResult}
 */
export function createTaskResult(agentId, correlationId, status, opts = {}) {
  return {
    kind: 'task-result',
    agentId,
    correlationId,
    status,
    ...(opts.data !== undefined ? { data: opts.data } : {}),
    ...(opts.error ? { error: opts.error } : {}),
    ...(opts.durationMs !== undefined ? { durationMs: opts.durationMs } : {}),
    ts: Date.now(),
  };
}

/**
 * 创建 StatusUpdate
 * @param {string} agentId
 * @param {typeof AgentRunStatus[number]} status
 * @param {Partial<Pick<StatusUpdate, 'currentTask' | 'progress' | 'meta'>>} [opts]
 * @returns {StatusUpdate}
 */
export function createStatusUpdate(agentId, status, opts = {}) {
  return {
    kind: 'status-update',
    agentId,
    status,
    ...(opts.currentTask ? { currentTask: opts.currentTask } : {}),
    ...(opts.progress !== undefined ? { progress: opts.progress } : {}),
    ...(opts.meta ? { meta: opts.meta } : {}),
    ts: Date.now(),
  };
}

/**
 * 创建 KnowledgeShare
 * @param {string} agentId
 * @param {string} topic
 * @param {unknown} content
 * @param {Partial<Pick<KnowledgeShare, 'targetAgentId' | 'contentType' | 'correlationId'>>} [opts]
 * @returns {KnowledgeShare}
 */
export function createKnowledgeShare(agentId, topic, content, opts = {}) {
  return {
    kind: 'knowledge-share',
    agentId,
    ...(opts.targetAgentId ? { targetAgentId: opts.targetAgentId } : {}),
    topic,
    content,
    ...(opts.contentType ? { contentType: opts.contentType } : {}),
    ...(opts.correlationId ? { correlationId: opts.correlationId } : {}),
    ts: Date.now(),
  };
}
