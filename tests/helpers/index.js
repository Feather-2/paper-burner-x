/**
 * Test Helpers - 统一导出入口
 *
 * @example
 * import {
 *   createScriptedModel,
 *   createStubTools,
 *   createMiddlewareRecorder,
 *   tmpdir,
 *   startLLMProxy,
 * } from '../helpers/index.js';
 *
 * @module tests/helpers
 */

// LLM Mock - 预设输出序列
export {
  createScriptedModel,
  createFixedModel,
  createToolCallingModel,
  createMultiTurnModel,
  createTimeoutModel,
  createErrorModel,
  assertCallCount,
  assertLastCallInput,
} from './scripted-model.js';

// Tool Mock - 工具执行模拟
export {
  createStubTools,
  createSuccessTools,
  createFailingTools,
  createDelayedTools,
  assertToolCallCount,
  assertToolCallOrder,
  assertToolCallArgs,
} from './stub-tools.js';

// Middleware Recorder - 钩子执行记录
export {
  createMiddlewareRecorder,
  createOrderRecorder,
  createErrorRecorder,
  createDelayedRecorder,
  assertHookOrder,
  assertHookCallCount,
  assertHookCalled,
  assertHookNotCalled,
  assertHookContext,
  getFullLifecycleOrder,
  getLLMOnlyLifecycleOrder,
  HookEvent,
} from './middleware-recorder.js';

// Tmpdir - 临时目录 Fixture
export {
  tmpdir,
  tmpdirWithFiles,
  tmpdirWithGit,
  withTmpdir,
  readTmpFile,
  writeTmpFile,
  tmpFileExists,
} from './tmpdir.js';

// LLM Proxy - SSE 流式响应 Mock
export {
  startLLMProxy,
  // SSE 构建器
  sse,
  json,
  error,
  messageStart,
  contentBlockStart,
  toolUseStart,
  contentDelta,
  toolInputDelta,
  contentBlockStop,
  messageDelta,
  messageStop,
  errorEvent,
  // 便捷构建器
  textResponse,
  toolCallResponse,
  textAndToolResponse,
  multiTurnTextResponses,
  // 断言
  assertRequestCount,
  assertLastRequestModel,
  assertLastRequestMessages,
} from './llm-proxy.js';
