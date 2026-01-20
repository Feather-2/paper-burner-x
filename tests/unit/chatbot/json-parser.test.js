/**
 * @file tests/chatbot/json-parser.test.js
 * @description ReActJsonParser 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';

const previousWindow = globalThis.window;
const previousWindowParser = previousWindow?.ReActJsonParser;
const previousGlobalParser = globalThis.ReActJsonParser;

const loadParser = async () => {
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = globalThis;
  }

  const module = await import('../../../js/chatbot/react/json-parser.js');
  return module.ReActJsonParser;
};

describe('ReActJsonParser', () => {
  let ReActJsonParser;

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    ReActJsonParser = await loadParser();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    if (typeof previousWindow === 'undefined') {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }

    if (typeof previousGlobalParser === 'undefined') {
      delete globalThis.ReActJsonParser;
    } else {
      globalThis.ReActJsonParser = previousGlobalParser;
    }

    if (previousWindow) {
      if (typeof previousWindowParser === 'undefined') {
        delete previousWindow.ReActJsonParser;
      } else {
        previousWindow.ReActJsonParser = previousWindowParser;
      }
    }
  });

  describe('_extractFromCodeBlock', () => {
    it('should parse JSON from markdown code block', () => {
      const response = [
        'Here is the result:',
        '```json',
        '{"action":"answer","thought":"t","answer":"hello"}',
        '```'
      ].join('\n');

      const result = ReActJsonParser._extractFromCodeBlock(response);
      expect(result).toEqual({ action: 'answer', thought: 't', answer: 'hello' });
    });

    it('should return null for invalid JSON', () => {
      const response = [
        '```json',
        '{"action":"answer","answer":"oops",}',
        '```'
      ].join('\n');

      const result = ReActJsonParser._extractFromCodeBlock(response);
      expect(result).toBeNull();
    });
  });

  describe('_extractRawJson', () => {
    it('should parse raw JSON object', () => {
      const response = '{"action":"answer","thought":"t","answer":"ok"}';
      const result = ReActJsonParser._extractRawJson(response);
      expect(result).toEqual({ action: 'answer', thought: 't', answer: 'ok' });
    });

    it('should parse JSON with leading/trailing text', () => {
      const response =
        'Some preface... {"action":"use_tool","thought":"t","tool":"keyword_search","params":{"query":"hello"}} ...some suffix';

      const result = ReActJsonParser._extractRawJson(response);
      expect(result).toEqual({
        action: 'use_tool',
        thought: 't',
        parallel: false,
        tool: 'keyword_search',
        params: { query: 'hello' }
      });
    });
  });

  describe('_extractWithFixing', () => {
    it('should fix trailing commas', () => {
      const response =
        'Call tool: { "action": "use_tool", "tool": "vector_search", "params": { "query": "hi", }, }';

      const result = ReActJsonParser._extractWithFixing(response);
      expect(result).toEqual({
        action: 'use_tool',
        thought: '',
        parallel: false,
        tool: 'vector_search',
        params: { query: 'hi' }
      });
    });

    it('should fix single quotes', () => {
      const response = "{ 'action': 'answer', 'thought': 't', 'answer': 'hi' }";

      const result = ReActJsonParser._extractWithFixing(response);
      expect(result).toEqual({ action: 'answer', thought: 't', answer: 'hi' });
    });
  });

  describe('_normalizeDecision', () => {
    it('should normalize answer action', () => {
      const normalized = ReActJsonParser._normalizeDecision({
        action: 'answer',
        thought: 't',
        answer: 'a',
        extra: 1
      });

      expect(normalized).toEqual({ action: 'answer', thought: 't', answer: 'a' });
    });

    it('should normalize use_tool single tool', () => {
      const normalized = ReActJsonParser._normalizeDecision({
        action: 'use_tool',
        thought: 't',
        tool: 'fetch',
        params: { url: 'u' }
      });

      expect(normalized).toEqual({
        action: 'use_tool',
        thought: 't',
        parallel: false,
        tool: 'fetch',
        params: { url: 'u' }
      });
    });

    it('should normalize use_tool parallel tool_calls', () => {
      const normalized = ReActJsonParser._normalizeDecision({
        action: 'use_tool',
        thought: 't',
        tool_calls: [
          { tool: 'keyword_search', params: { query: 'q' } },
          { tool: 'fetch', params: { url: 'u' } }
        ]
      });

      expect(normalized).toEqual({
        action: 'use_tool',
        thought: 't',
        parallel: true,
        tool_calls: [
          { tool: 'keyword_search', params: { query: 'q' } },
          { tool: 'fetch', params: { url: 'u' } }
        ]
      });
    });

    it('should throw when missing required fields', () => {
      expect(() => ReActJsonParser._normalizeDecision({})).toThrow('缺少 action 字段');
      expect(() => ReActJsonParser._normalizeDecision({ action: 'use_tool' })).toThrow(
        'use_tool 需要指定 tool 或 tool_calls'
      );
    });
  });

  describe('parse (end-to-end)', () => {
    it('should parse JSON from code block responses', () => {
      const response = ['OK', '```', '{"action":"answer","answer":"done"}', '```'].join('\n');
      const result = ReActJsonParser.parse(response);

      expect(result).toEqual({ action: 'answer', thought: '', answer: 'done' });
    });

    it('should parse raw JSON embedded in text', () => {
      const response = 'Result: {"action":"use_tool","tool":"regex_search","params":{"pattern":"abc"}}';
      const result = ReActJsonParser.parse(response);

      expect(result).toEqual({
        action: 'use_tool',
        thought: '',
        parallel: false,
        tool: 'regex_search',
        params: { pattern: 'abc' }
      });
    });

    it('should parse after fixing common JSON mistakes', () => {
      const response =
        "Use tool: { 'action': 'use_tool', 'tool_calls': [ { 'tool': 'keyword_search', 'params': { 'query': 'hello', }, }, ], }";

      const result = ReActJsonParser.parse(response);

      expect(result).toEqual({
        action: 'use_tool',
        thought: '',
        parallel: true,
        tool_calls: [{ tool: 'keyword_search', params: { query: 'hello' } }]
      });
    });

    it('should fall back to plain text answer when no JSON found', () => {
      const response = 'Just a plain text response.';
      const result = ReActJsonParser.parse(response);

      expect(result.action).toBe('answer');
      expect(result.answer).toBe('Just a plain text response.');
      expect(result.thought).toBe('无法解析为工具调用，作为直接回答');
    });
  });
});
