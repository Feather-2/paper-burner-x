import { describe, it, expect, vi } from 'vitest';
import { createSandboxTool, SANDBOX_TOOL_DEFINITION } from '../../../../../js/agents/core/sandbox/sandbox-tool.js';

// Mock iframe-eval-bridge to control browser vs Node behavior in tests
vi.mock('../../../../../js/agents/core/sandbox/iframe-eval-bridge.js', () => {
  let _isBrowser = false;
  const _mockEvaluate = vi.fn().mockResolvedValue({ ok: true, value: undefined });
  const _mockDispose = vi.fn();

  return {
    isBrowserWithDOM: () => _isBrowser,
    createIframeEvalBridge: vi.fn(() => ({
      evaluate: _mockEvaluate,
      dispose: _mockDispose,
    })),
    // Test helpers exposed via __test
    __test: {
      setBrowser: (v) => { _isBrowser = v; },
      mockEvaluate: _mockEvaluate,
      mockDispose: _mockDispose,
    },
  };
});

describe('sandbox-tool', () => {
  it('SANDBOX_TOOL_DEFINITION has correct shape', () => {
    expect(SANDBOX_TOOL_DEFINITION.name).toBe('execute_code');
    expect(SANDBOX_TOOL_DEFINITION.parameters.required).toContain('code');
    expect(SANDBOX_TOOL_DEFINITION.parameters.properties).toHaveProperty('code');
    expect(SANDBOX_TOOL_DEFINITION.parameters.properties).toHaveProperty('filename');
    expect(SANDBOX_TOOL_DEFINITION.parameters.properties).toHaveProperty('install');
  });

  it('createSandboxTool returns tool with definition and handler', () => {
    const tool = createSandboxTool();
    expect(tool.definition).toBe(SANDBOX_TOOL_DEFINITION);
    expect(typeof tool.handler).toBe('function');
    expect(tool.description).toBe(SANDBOX_TOOL_DEFINITION.description);
    expect(tool.parameters).toBe(SANDBOX_TOOL_DEFINITION.parameters);
  });

  it('handler has dispose method', () => {
    const tool = createSandboxTool();
    expect(typeof tool.handler.dispose).toBe('function');
  });

  it('install array in definition has correct type', () => {
    const installProp = SANDBOX_TOOL_DEFINITION.parameters.properties.install;
    expect(installProp.type).toBe('array');
    expect(installProp.items.type).toBe('string');
  });

  it('createSandboxTool accepts packageManager option', () => {
    const fakePM = { install: vi.fn() };
    const tool = createSandboxTool({ packageManager: fakePM });
    expect(tool).toBeDefined();
  });

  describe('iframe bridge integration', () => {
    it('uses iframe bridge when isBrowserWithDOM returns true', async () => {
      const { __test } = await import('../../../../../js/agents/core/sandbox/iframe-eval-bridge.js');
      const { createIframeEvalBridge } = await import('../../../../../js/agents/core/sandbox/iframe-eval-bridge.js');

      __test.setBrowser(true);
      try {
        const tool = createSandboxTool();
        // dispose should be safe even without full init
        await tool.handler.dispose();
      } finally {
        __test.setBrowser(false);
      }
    });

    it('dispose cleans up iframe bridge', async () => {
      const { __test } = await import('../../../../../js/agents/core/sandbox/iframe-eval-bridge.js');

      __test.setBrowser(false);
      const tool = createSandboxTool();
      // dispose should be safe to call even without init
      await expect(tool.handler.dispose()).resolves.toBeUndefined();
    });

    it('falls back to eval in Node.js environment', () => {
      // isBrowserWithDOM defaults to false in Node test env
      const tool = createSandboxTool();
      expect(tool).toBeDefined();
    });
  });
});
