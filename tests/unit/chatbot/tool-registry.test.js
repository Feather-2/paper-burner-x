/**
 * @file tests/chatbot/tool-registry.test.js
 * @description ToolRegistry 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';

const previousWindow = globalThis.window;
const previousWindowRegistry = previousWindow?.ToolRegistry;
const previousGlobalRegistry = globalThis.ToolRegistry;

const loadToolRegistry = async () => {
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = globalThis;
  }

  const module = await import('../../js/chatbot/react/tool-registry.js');
  return module.ToolRegistry;
};

describe('ToolRegistry', () => {
  let ToolRegistry;

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    ToolRegistry = await loadToolRegistry();
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

    if (typeof previousGlobalRegistry === 'undefined') {
      delete globalThis.ToolRegistry;
    } else {
      globalThis.ToolRegistry = previousGlobalRegistry;
    }

    if (previousWindow) {
      if (typeof previousWindowRegistry === 'undefined') {
        delete previousWindow.ToolRegistry;
      } else {
        previousWindow.ToolRegistry = previousWindowRegistry;
      }
    }
  });

  it('should register tools and expose definitions', () => {
    const registry = new ToolRegistry();

    const execute = vi.fn(async (params) => ({ success: true, echoed: params }));
    registry.register({
      name: 'unit_test_tool',
      description: 'test tool',
      parameters: {
        value: { type: 'string', description: 'value' }
      },
      execute
    });

    const definitions = registry.getToolDefinitions();
    const definition = definitions.find((d) => d.name === 'unit_test_tool');

    expect(definition).toEqual({
      name: 'unit_test_tool',
      description: 'test tool',
      parameters: {
        value: { type: 'string', description: 'value' }
      }
    });
  });

  it('should throw when registering invalid tools', () => {
    const registry = new ToolRegistry();

    expect(() => registry.register({ name: 'missing_execute' })).toThrow('工具必须包含name和execute字段');
    expect(() => registry.register({ execute: async () => ({ success: true }) })).toThrow('工具必须包含name和execute字段');
  });

  it('should execute a registered tool', async () => {
    const registry = new ToolRegistry();

    const execute = vi.fn(async (params) => ({ success: true, value: params.value }));
    registry.register({
      name: 'echo',
      description: 'echo tool',
      parameters: {
        value: { type: 'string', description: 'value' }
      },
      execute
    });

    const result = await registry.execute('echo', { value: 'hello' });
    expect(execute).toHaveBeenCalledWith({ value: 'hello' });
    expect(result).toEqual({ success: true, value: 'hello' });
  });

  it('should wrap tool execution errors as {success:false}', async () => {
    const registry = new ToolRegistry();

    registry.register({
      name: 'boom',
      description: 'throws',
      parameters: {},
      execute: async () => {
        throw new Error('boom');
      }
    });

    await expect(registry.execute('boom', {})).resolves.toEqual({ success: false, error: 'boom' });
  });

  it('should throw for unknown tool name', async () => {
    const registry = new ToolRegistry();
    await expect(registry.execute('missing_tool', {})).rejects.toThrow('未找到工具: missing_tool');
  });

  describe('getAvailableToolDefinitions', () => {
    it('should filter tools based on document state flags', () => {
      const registry = new ToolRegistry();

      const base = registry.getAvailableToolDefinitions(false, false, false).map((t) => t.name);
      expect(base).toContain('grep');
      expect(base).toContain('regex_search');
      expect(base).toContain('boolean_search');
      expect(base).not.toContain('vector_search');
      expect(base).not.toContain('keyword_search');
      expect(base).not.toContain('search_semantic_groups');

      const withVectorIndex = registry.getAvailableToolDefinitions(false, true, false).map((t) => t.name);
      expect(withVectorIndex).toContain('vector_search');
      expect(withVectorIndex).not.toContain('search_semantic_groups');

      const withChunks = registry.getAvailableToolDefinitions(false, false, true).map((t) => t.name);
      expect(withChunks).toContain('keyword_search');
      expect(withChunks).not.toContain('search_semantic_groups');
      expect(withChunks).not.toContain('vector_search');

      const withSemanticGroups = registry.getAvailableToolDefinitions(true, false, false).map((t) => t.name);
      expect(withSemanticGroups).toContain('search_semantic_groups');
      expect(withSemanticGroups).toContain('fetch_group_text');
      expect(withSemanticGroups).toContain('fetch');
      expect(withSemanticGroups).toContain('map');
      expect(withSemanticGroups).toContain('list_all_groups');
      expect(withSemanticGroups).toContain('keyword_search');
      expect(withSemanticGroups).not.toContain('vector_search');
    });
  });
});

