import { describe, it, expect, vi } from 'vitest';
import { createSandboxTool, SANDBOX_TOOL_DEFINITION } from '../../../../../js/agents/core/sandbox/sandbox-tool.js';

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
});
