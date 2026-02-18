import { describe, it, expect, vi } from 'vitest';
import { createSandboxTool, SANDBOX_TOOL_DEFINITION } from '../../../../../js/agents/core/node-compat/sandbox-tool.js';

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
    expect(tool.available).toBe(false);
    expect(tool.unavailableReason).toContain('browser sandbox (iframe)');
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
    expect(tool.definition.runtime.node.supported).toBe(false);
  });

  describe('iframe bridge integration', () => {
    it('uses iframe bridge when isBrowserWithDOM returns true', async () => {
      const { __test } = await import('../../../../../js/agents/core/sandbox/iframe-eval-bridge.js');

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

    it('rejects host-side eval fallback in Node.js environment', async () => {
      // isBrowserWithDOM defaults to false in Node test env
      const tool = createSandboxTool();
      const result = await tool.handler({ code: 'module.exports = 1;' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('browser sandbox (iframe)');
      expect(result.error).toContain('disabled for security');
      await tool.handler.dispose();
    });

    it('parses scoped package install spec correctly', async () => {
      const { __test } = await import('../../../../../js/agents/core/sandbox/iframe-eval-bridge.js');
      __test.setBrowser(true);
      const fakePM = {
        install: vi.fn().mockResolvedValue({ name: '@babel/core', version: '7.24.0', deps: 0 }),
      };
      const tool = createSandboxTool({ packageManager: fakePM });
      try {
        await tool.handler({
          code: 'module.exports = true;',
          install: ['@babel/core@7.24.0'],
        });
        expect(fakePM.install).toHaveBeenCalledWith('@babel/core', { version: '7.24.0' });
      } finally {
        await tool.handler.dispose();
        __test.setBrowser(false);
      }
    });

    it('captures console output into result.output', async () => {
      const { __test } = await import('../../../../../js/agents/core/sandbox/iframe-eval-bridge.js');
      const onConsole = vi.fn();
      __test.setBrowser(true);

      __test.mockEvaluate.mockImplementationOnce(async () => ({
        ok: true,
        value: (_exports, _require, module, _filename, _dirname, _process, scopedConsole) => {
          scopedConsole.log('hello', 123);
          module.exports = { ok: true };
        },
      }));

      try {
        const tool = createSandboxTool({ onConsole });
        const result = await tool.handler({ code: 'module.exports = "ignored-by-mock";' });
        expect(result.success).toBe(true);
        expect(result.output).toContain('hello 123');
        expect(onConsole).toHaveBeenCalledWith('log', ['hello', 123]);
        await tool.handler.dispose();
      } finally {
        __test.setBrowser(false);
      }
    });
  });
});
