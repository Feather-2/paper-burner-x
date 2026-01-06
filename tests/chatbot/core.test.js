/**
 * @file tests/chatbot/core.test.js
 * @description Chatbot 核心模块测试 (Phase 8)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 动态导入 ESM 模块
const loadModules = async () => {
  const streaming = await import('../../js/chatbot/core/streaming-adapter.js');
  const handler = await import('../../js/chatbot/core/message-handler.js');
  return { streaming, handler };
};

describe('SSEStreamParser', () => {
  let SSEStreamParser;

  beforeEach(async () => {
    const { streaming } = await loadModules();
    SSEStreamParser = streaming.SSEStreamParser;
  });

  it('should parse OpenAI format SSE', () => {
    const parser = new SSEStreamParser();
    const chunk = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n';
    const results = parser.parse(chunk);

    expect(results.length).toBe(1);
    expect(results[0].content).toBe('Hello');
    expect(results[0].done).toBe(false);
  });

  it('should parse multiple lines', () => {
    const parser = new SSEStreamParser();
    const chunk = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[{"delta":{"content":" World"}}]}\n\n';
    const results = parser.parse(chunk);

    expect(results.length).toBe(2);
    expect(results[0].content).toBe('Hello');
    expect(results[1].content).toBe(' World');
  });

  it('should handle [DONE] marker', () => {
    const parser = new SSEStreamParser();
    const chunk = 'data: [DONE]\n\n';
    const results = parser.parse(chunk);

    expect(results.length).toBe(1);
    expect(results[0].done).toBe(true);
    expect(results[0].content).toBe('');
  });

  it('should handle Claude format', () => {
    const parser = new SSEStreamParser();
    const chunk = 'data: {"type":"content_block_delta","delta":{"text":"Hello"}}\n\n';
    const results = parser.parse(chunk);

    expect(results.length).toBe(1);
    expect(results[0].content).toBe('Hello');
  });

  it('should handle message_stop event', () => {
    const parser = new SSEStreamParser();
    const chunk = 'data: {"type":"message_stop"}\n\n';
    const results = parser.parse(chunk);

    expect(results.length).toBe(1);
    expect(results[0].done).toBe(true);
  });

  it('should skip comments', () => {
    const parser = new SSEStreamParser();
    const chunk = ': this is a comment\ndata: {"choices":[{"delta":{"content":"test"}}]}\n\n';
    const results = parser.parse(chunk);

    expect(results.length).toBe(1);
    expect(results[0].content).toBe('test');
  });

  it('should buffer incomplete lines', () => {
    const parser = new SSEStreamParser();

    // First chunk - incomplete
    let results = parser.parse('data: {"choices":[{"delta"');
    expect(results.length).toBe(0);

    // Second chunk - completes the line
    results = parser.parse(':{"content":"Hello"}}]}\n\n');
    expect(results.length).toBe(1);
    expect(results[0].content).toBe('Hello');
  });
});

describe('NDJSONStreamParser', () => {
  let NDJSONStreamParser;

  beforeEach(async () => {
    const { streaming } = await loadModules();
    NDJSONStreamParser = streaming.NDJSONStreamParser;
  });

  it('should parse NDJSON lines', () => {
    const parser = new NDJSONStreamParser();
    const chunk = '{"content":"Hello"}\n{"content":" World"}\n';
    const results = parser.parse(chunk);

    expect(results.length).toBe(2);
    expect(results[0].content).toBe('Hello');
    expect(results[1].content).toBe(' World');
  });

  it('should handle done flag', () => {
    const parser = new NDJSONStreamParser();
    const chunk = '{"content":"Final","done":true}\n';
    const results = parser.parse(chunk);

    expect(results.length).toBe(1);
    expect(results[0].done).toBe(true);
  });

  it('should handle delta.content format', () => {
    const parser = new NDJSONStreamParser();
    const chunk = '{"delta":{"content":"Hello"}}\n';
    const results = parser.parse(chunk);

    expect(results.length).toBe(1);
    expect(results[0].content).toBe('Hello');
  });
});

describe('StreamingAdapter', () => {
  let StreamingAdapter, StreamType;

  beforeEach(async () => {
    const { streaming } = await loadModules();
    StreamingAdapter = streaming.StreamingAdapter;
    StreamType = streaming.StreamType;
  });

  it('should create with default SSE type', () => {
    const adapter = new StreamingAdapter();
    expect(adapter.type).toBe(StreamType.SSE);
  });

  it('should create with specified type', () => {
    const adapter = new StreamingAdapter({ type: StreamType.NDJSON });
    expect(adapter.type).toBe(StreamType.NDJSON);
  });

  it('should accumulate content', () => {
    const chunks = [];
    const adapter = new StreamingAdapter({
      onChunk: (chunk) => chunks.push(chunk)
    });

    adapter._processResults([
      { content: 'Hello', done: false },
      { content: ' World', done: false }
    ]);

    expect(chunks).toEqual(['Hello', ' World']);
    expect(adapter.fullContent).toBe('Hello World');
  });

  it('should call onDone when done', () => {
    let doneResult = null;
    const adapter = new StreamingAdapter({
      onDone: (result) => { doneResult = result; }
    });

    adapter._processResults([
      { content: 'Test', done: false },
      { content: '', done: true }
    ]);

    expect(doneResult).not.toBeNull();
    expect(doneResult.content).toBe('Test');
  });

  it('should reset state', () => {
    const adapter = new StreamingAdapter();
    adapter.fullContent = 'some content';
    adapter.meta = { model: 'test' };

    adapter.reset();

    expect(adapter.fullContent).toBe('');
    expect(adapter.meta).toEqual({});
  });
});

describe('MessageHandler', () => {
  let MessageHandler;

  beforeEach(async () => {
    const { handler } = await loadModules();
    MessageHandler = handler.MessageHandler;
  });

  it('should create with default config', () => {
    const handler = new MessageHandler();
    expect(handler.maxContextTokens).toBe(4000);
    expect(handler.modelRouter).toBeNull();
    expect(handler.retriever).toBeNull();
  });

  it('should create with custom config', () => {
    const mockRouter = { chat: vi.fn() };
    const handler = new MessageHandler({
      modelRouter: mockRouter,
      maxContextTokens: 8000
    });

    expect(handler.modelRouter).toBe(mockRouter);
    expect(handler.maxContextTokens).toBe(8000);
  });

  it('should build messages correctly', () => {
    const handler = new MessageHandler();
    const systemPrompt = 'You are a helpful assistant.';
    const history = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi!' }
    ];
    const userMessage = { role: 'user', content: 'How are you?' };

    const messages = handler._buildMessages(systemPrompt, history, userMessage);

    expect(messages.length).toBe(3);
    expect(messages[0]).toEqual({ role: 'system', content: systemPrompt });
    expect(messages[1]).toEqual({ role: 'user', content: 'Hello' });
    expect(messages[2]).toEqual({ role: 'user', content: 'How are you?' });
  });

  it('should skip system message if null', () => {
    const handler = new MessageHandler();
    const userMessage = { role: 'user', content: 'Hello' };

    const messages = handler._buildMessages(null, [], userMessage);

    expect(messages.length).toBe(1);
    expect(messages[0]).toEqual({ role: 'user', content: 'Hello' });
  });

  it('should generate default system prompt', () => {
    const handler = new MessageHandler();
    const prompt = handler._defaultSystemPrompt({ retrievedContext: [] });

    expect(prompt).toContain('学术助手');
  });

  it('should include retrieved context in prompt', () => {
    const handler = new MessageHandler();
    const retrievedContext = [
      { text: 'Document content 1' },
      { content: 'Document content 2' }
    ];
    const prompt = handler._defaultSystemPrompt({ retrievedContext });

    expect(prompt).toContain('Document content 1');
    expect(prompt).toContain('Document content 2');
    expect(prompt).toContain('相关的文档片段');
  });
});

describe('createStreamingAdapter', () => {
  it('should create StreamingAdapter instance', async () => {
    const { streaming } = await loadModules();
    const adapter = streaming.createStreamingAdapter({ type: streaming.StreamType.NDJSON });

    expect(adapter).toBeInstanceOf(streaming.StreamingAdapter);
    expect(adapter.type).toBe(streaming.StreamType.NDJSON);
  });
});

describe('createMessageHandler', () => {
  it('should create MessageHandler instance', async () => {
    const { handler } = await loadModules();
    const mh = handler.createMessageHandler({ maxContextTokens: 2000 });

    expect(mh).toBeInstanceOf(handler.MessageHandler);
    expect(mh.maxContextTokens).toBe(2000);
  });
});
