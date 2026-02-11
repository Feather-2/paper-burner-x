import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryVfs } from '../../../../../js/agents/vfs/vfs.memory.js';
import { createSandboxTool, SANDBOX_TOOL_DEFINITION } from '../../../../../js/agents/core/sandbox/sandbox-tool.js';
import { createToolExecutor } from '../../../../../js/agents/runtime/tools/tool-executor.js';
import { ToolRegistry } from '../../../../../js/agents/runtime/core/tool-registry.js';

describe('sandbox-tool <> ToolExecutor integration', () => {
  let vfs;
  let tool;
  let executor;

  beforeEach(() => {
    vfs = new MemoryVfs();
    tool = createSandboxTool({ vfs });
    executor = createToolExecutor();
    executor.register('execute_code', tool);
  });

  afterEach(async () => {
    if (tool.handler.dispose) await tool.handler.dispose();
  });

  it('registers sandbox tool with correct definition', () => {
    const defs = executor.getToolDefinitions();
    const found = defs.find(d => d.name === 'execute_code');
    expect(found).toBeDefined();
    expect(found.description).toBe(SANDBOX_TOOL_DEFINITION.description);
  });

  it('sandbox tool definition has required parameters', () => {
    expect(SANDBOX_TOOL_DEFINITION.parameters.properties.code).toBeDefined();
    expect(SANDBOX_TOOL_DEFINITION.parameters.required).toContain('code');
  });

  it('sandbox tool has install parameter', () => {
    expect(SANDBOX_TOOL_DEFINITION.parameters.properties.install).toBeDefined();
    expect(SANDBOX_TOOL_DEFINITION.parameters.properties.install.type).toBe('array');
  });

  it('tool is callable through executor', async () => {
    const result = await executor.execute('execute_code', {
      code: 'module.exports = 42;',
    }, {});
    expect(result).toBeDefined();
    expect(typeof result.success === 'boolean' || typeof result.ok === 'boolean').toBe(true);
  });

  it('executor lists execute_code in tool names', () => {
    const defs = executor.getToolDefinitions();
    const names = defs.map(d => d.name);
    expect(names).toContain('execute_code');
  });

  it('returns success:true for valid code', async () => {
    const result = await executor.execute('execute_code', {
      code: 'module.exports = { value: 123 };',
    }, {});
    expect(result.ok).toBe(true);
    expect(result.raw).toBeDefined();
    expect(result.raw.success).toBe(true);
  });

  it('returns error for code that throws', async () => {
    const result = await executor.execute('execute_code', {
      code: 'throw new Error("boom");',
    }, {});
    expect(result.raw).toBeDefined();
    expect(result.raw.success).toBe(false);
    expect(result.raw.error).toContain('boom');
  });

  it('supports custom filename', async () => {
    const result = await executor.execute('execute_code', {
      code: 'module.exports = "ok";',
      filename: 'custom-script.js',
    }, {});
    expect(result.ok).toBe(true);
    expect(result.raw).toBeDefined();
    expect(result.raw.success).toBe(true);
  });

  it('lazy-initializes env on first call, reuses on second', async () => {
    const r1 = await executor.execute('execute_code', {
      code: 'module.exports = 1;',
    }, {});
    const r2 = await executor.execute('execute_code', {
      code: 'module.exports = 2;',
    }, {});
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it('unknown tool returns error', async () => {
    const result = await executor.execute('nonexistent_tool', {}, {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });
});

describe('sandbox-tool with PackageManager', () => {
  it('accepts packageManager option', () => {
    const fakePM = { install: vi.fn().mockResolvedValue({ name: 'test', version: '1.0.0', deps: 0 }) };
    const tool = createSandboxTool({ packageManager: fakePM });
    expect(tool).toBeDefined();
    expect(tool.handler).toBeTypeOf('function');
  });

  it('tool has dispose method', () => {
    const tool = createSandboxTool();
    expect(tool.handler.dispose).toBeTypeOf('function');
  });

  it('calls packageManager.install when install array is provided', async () => {
    const fakePM = {
      install: vi.fn().mockResolvedValue({ name: 'lodash', version: '4.17.21', deps: 0 }),
    };
    const vfs = new MemoryVfs();
    const tool = createSandboxTool({ vfs, packageManager: fakePM });

    await tool.handler({ code: 'module.exports = true;', install: ['lodash'] });

    expect(fakePM.install).toHaveBeenCalledTimes(1);
    expect(fakePM.install).toHaveBeenCalledWith('lodash', { version: 'latest' });

    await tool.handler.dispose();
  });

  it('installs multiple packages sequentially', async () => {
    const fakePM = {
      install: vi.fn().mockResolvedValue({ name: 'pkg', version: '1.0.0', deps: 0 }),
    };
    const vfs = new MemoryVfs();
    const tool = createSandboxTool({ vfs, packageManager: fakePM });

    await tool.handler({ code: 'module.exports = true;', install: ['pkg-a', 'pkg-b@2.0.0'] });

    expect(fakePM.install).toHaveBeenCalledTimes(2);
    expect(fakePM.install).toHaveBeenCalledWith('pkg-a', { version: 'latest' });
    expect(fakePM.install).toHaveBeenCalledWith('pkg-b', { version: '2.0.0' });

    await tool.handler.dispose();
  });

  it('skips install when no packageManager provided', async () => {
    const vfs = new MemoryVfs();
    const tool = createSandboxTool({ vfs });

    // Should not throw even with install array but no packageManager
    const result = await tool.handler({ code: 'module.exports = true;', install: ['lodash'] });
    expect(result).toBeDefined();
    expect(result.success).toBe(true);

    await tool.handler.dispose();
  });
});

describe('sandbox-tool <> ToolRegistry integration', () => {
  it('registers and calls via ToolRegistry', async () => {
    const vfs = new MemoryVfs();
    const tool = createSandboxTool({ vfs });

    const registry = new ToolRegistry({
      tools: {
        execute_code: {
          fn: tool.handler,
          parameters: tool.parameters,
        },
      },
    });

    expect(registry.hasTool('execute_code')).toBe(true);
    expect(registry.getToolNames()).toContain('execute_code');

    const result = await registry.callTool('execute_code', {
      code: 'module.exports = "from-registry";',
    }, {});

    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();

    await tool.handler.dispose();
  });
});

describe('sandbox-tool dispose lifecycle', () => {
  it('dispose cleans up resources', async () => {
    const vfs = new MemoryVfs();
    const tool = createSandboxTool({ vfs });

    // Trigger lazy init
    await tool.handler({ code: 'module.exports = 1;' });
    // Dispose
    await tool.handler.dispose();
    // Double dispose is safe
    await tool.handler.dispose();
  });

  it('can execute again after dispose (re-init)', async () => {
    const vfs = new MemoryVfs();
    const tool = createSandboxTool({ vfs });

    await tool.handler({ code: 'module.exports = 1;' });
    await tool.handler.dispose();

    // After dispose, calling handler again should re-initialize
    const result = await tool.handler({ code: 'module.exports = 2;' });
    expect(result.success).toBe(true);

    await tool.handler.dispose();
  });
});
