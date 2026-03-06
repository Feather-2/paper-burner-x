import { describe, expect, it } from 'vitest';

import { quickKernel } from '../../js/agents/core/index.js';
import { AgentBuilder, createAgent } from '../../js/agents/sdk/AgentBuilder.js';

describe('agents startup smoke', () => {
  it('quickKernel(minimal) starts and stops with core buses available', async () => {
    const kernel = await quickKernel('minimal', { keepHistory: true, keepLog: true });

    try {
      expect(kernel).toBeTruthy();
      expect(kernel.events).toBeTruthy();
      expect(kernel.state).toBeTruthy();
      expect(kernel.services).toBeTruthy();
      expect(kernel.status).toBe('running');
    } finally {
      await kernel.stop();
      expect(kernel.status).toBe('stopped');
    }
  });

  it('AgentBuilder builds a runnable agent with a minimal capability', async () => {
    const builder = new AgentBuilder({ actor: 'smoke-agent' });
    builder.useCapability('Echo', async (args) => ({ echo: String(args?.text || '') }));

    const agent = builder.build();
    const result = await agent.toolExecutor('Echo', { text: 'hello' }, { state: {}, signal: null });

    expect(result.success).toBe(true);
    expect(result.data.echo).toBe('hello');

    await agent.dispose();
  });

  it('createAgent helper preserves the builder startup path', async () => {
    const builder = createAgent({ actor: 'smoke-helper' });
    builder.useCapability('Ping', async () => ({ pong: true }));

    const agent = builder.build();
    const result = await agent.toolExecutor('Ping', {}, { state: {}, signal: null });

    expect(result.success).toBe(true);
    expect(result.data.pong).toBe(true);

    await agent.dispose();
  });
});
